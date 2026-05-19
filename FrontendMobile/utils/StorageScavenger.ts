import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isTransferActive } from './ActiveTransfersRegistry';

const SCAVENGER_COOLDOWN_MS = 30 * 60 * 1000; // 30-minute cooldown lock
const SCAVENGER_LAST_RUN_KEY = 'prama_scavenger_last_run';
const TTL_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2-hour Time-To-Live
const BATCH_SIZE = 20; // 20 files concurrency batch limit

/**
 * Normalizes Expo FileSystem modificationTime timestamps.
 * Expo returns seconds on some platforms/SDKs and milliseconds on others.
 */
function normalizeTimestamp(time: number): number {
  // If time is less than 100 billion, it's definitely a seconds-based epoch timestamp
  if (time < 100000000000) {
    return time * 1000;
  }
  return time;
}

/**
 * Silently sweep the target directory for expired, orphaned .enc files
 */
async function sweepDirectory(dirPath: string | null): Promise<number> {
  if (!dirPath) return 0;

  try {
    const files = await FileSystem.readDirectoryAsync(dirPath);
    // Option A: Flat Namespace Sweep. We only filter for .enc files
    const encFiles = files.filter(f => f.endsWith('.enc'));
    if (encFiles.length === 0) return 0;

    let purgeCount = 0;
    const now = Date.now();

    // Concurrency Batch loop to protect React Native Bridge from saturation
    for (let i = 0; i < encFiles.length; i += BATCH_SIZE) {
      const batch = encFiles.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (fileName) => {
          const filePath = dirPath + fileName;

          // Gatekeeper: Check Active-Transfer Registry to prevent premature purges of active workers
          if (isTransferActive(fileName) || isTransferActive(filePath)) {
            console.log(`🛡️ [Scavenger] File locked by active transfer registry: ${fileName}`);
            return;
          }

          try {
            const info = await FileSystem.getInfoAsync(filePath);
            if (!info.exists || info.isDirectory) return;

            const modTime = info.modificationTime ? normalizeTimestamp(info.modificationTime) : now;
            const age = now - modTime;

            // 2-Hour TTL Evaluation
            if (age > TTL_THRESHOLD_MS) {
              console.log(`🗑️ [Scavenger] Purging zombie E2EE file (${Math.round(age / 1000 / 60)}m old): ${fileName}`);
              await FileSystem.deleteAsync(filePath, { idempotent: true });
              purgeCount++;
            }
          } catch (fileErr) {
            console.warn(`[Scavenger] Failed to evaluate metadata for ${fileName}:`, fileErr);
          }
        })
      );
    }

    return purgeCount;
  } catch (err) {
    console.warn(`[Scavenger] Error reading directory ${dirPath}:`, err);
    return 0;
  }
}

/**
 * Main scavenger daemon runner bound to the AppState listener transitions
 */
export async function runStorageScavengerSweep(force = false): Promise<void> {
  try {
    const now = Date.now();

    // AppState CPU Thrash lock: enforce cooldown guard unless forced
    if (!force) {
      const lastRunStr = await AsyncStorage.getItem(SCAVENGER_LAST_RUN_KEY);
      if (lastRunStr) {
        const lastRun = parseInt(lastRunStr, 10);
        if (now - lastRun < SCAVENGER_COOLDOWN_MS) {
          console.log('⚡ [Scavenger] Sweep skipped due to 30-minute cooldown lock.');
          return;
        }
      }
    }

    console.log('🧹 [Scavenger] Initiating background E2EE zombie file sweep...');

    // Sweep both DocumentDirectory and CacheDirectory to catch all temporary encryption artifacts
    const docsPurged = await sweepDirectory(FileSystem.documentDirectory);
    const cachePurged = await sweepDirectory(FileSystem.cacheDirectory);

    console.log(`🧹 [Scavenger] Sweep complete. Purged ${docsPurged + cachePurged} E2EE zombie file(s).`);

    // Lock the run time
    await AsyncStorage.setItem(SCAVENGER_LAST_RUN_KEY, now.toString());
  } catch (globalErr) {
    console.error('[Scavenger] Storage clean daemon failure:', globalErr);
  }
}
