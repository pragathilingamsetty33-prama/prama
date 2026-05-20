import * as SQLite from 'expo-sqlite';

/**
 * GroupSessionStore
 * Handles persistent storage for E2EE group sessions and skipped keys using SQLite.
 * Implements WAL mode for concurrent read/writes and strict BLOB affinity for key integrity.
 */

const DB_NAME = 'prama_secure_vault.db';
let dbInstance: SQLite.SQLiteDatabase | null = null;

export const initGroupSessionDB = async (): Promise<SQLite.SQLiteDatabase> => {
  if (dbInstance) return dbInstance;

  // Open database (using async for initial setup)
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // 1. Enforce WAL mode to prevent SQLITE_BUSY during concurrent background syncs
  await db.execAsync('PRAGMA journal_mode = WAL;');
  
  // 2. Create tables with strict BLOB affinity for cryptographic material
  // This prevents SQLite's Dynamic Type Affinity from stripping leading zeros in hex strings
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS group_sessions (
      groupId TEXT NOT NULL,
      senderId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      sequenceNumber INTEGER NOT NULL,
      ratchetKey BLOB NOT NULL,
      PRIMARY KEY (groupId, senderId)
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS skipped_group_keys (
      groupId TEXT NOT NULL,
      senderId TEXT NOT NULL,
      sequenceNumber INTEGER NOT NULL,
      messageKey BLOB NOT NULL,
      decryptionAttempts INTEGER DEFAULT 0,
      PRIMARY KEY (groupId, senderId, sequenceNumber)
    );
  `);

  dbInstance = db;
  return db;
};

// --- Group Session CRUD ---

export interface GroupSessionState {
  groupId: string;
  senderId: string;
  sessionId: string;
  sequenceNumber: number;
  ratchetKey: Uint8Array;
}

export const saveGroupSession = async (sessionState: GroupSessionState): Promise<void> => {
  const db = await initGroupSessionDB();
  const ratchetKeyHex = Buffer.from(sessionState.ratchetKey).toString('hex');
  
  await db.runAsync(
    'INSERT OR REPLACE INTO group_sessions (groupId, senderId, sessionId, sequenceNumber, ratchetKey) VALUES (?, ?, ?, ?, ?)',
    [sessionState.groupId, sessionState.senderId, sessionState.sessionId, sessionState.sequenceNumber, ratchetKeyHex]
  );
};

export const getGroupSession = async (groupId: string, senderId: string): Promise<GroupSessionState | null> => {
  const db = await initGroupSessionDB();
  const result = await db.getFirstAsync<{
    groupId: string;
    senderId: string;
    sessionId: string;
    sequenceNumber: number;
    ratchetKey: string;
  }>('SELECT * FROM group_sessions WHERE groupId = ? AND senderId = ?', [groupId, senderId]);

  if (!result) return null;

  return {
    groupId: result.groupId,
    senderId: result.senderId,
    sessionId: result.sessionId,
    sequenceNumber: result.sequenceNumber,
    ratchetKey: new Uint8Array(Buffer.from(result.ratchetKey, 'hex')),
  };
};

// --- Skipped Keys CRUD (Verify-Then-Evict & 3-Strike Poison Gate) ---

export interface SkippedGroupKey {
  groupId: string;
  senderId: string;
  sequenceNumber: number;
  messageKey: Uint8Array;
  decryptionAttempts: number;
}

export const saveSkippedGroupKey = async (skippedKey: SkippedGroupKey): Promise<void> => {
  const db = await initGroupSessionDB();
  const messageKeyHex = Buffer.from(skippedKey.messageKey).toString('hex');

  await db.runAsync(
    'INSERT OR REPLACE INTO skipped_group_keys (groupId, senderId, sequenceNumber, messageKey, decryptionAttempts) VALUES (?, ?, ?, ?, ?)',
    [skippedKey.groupId, skippedKey.senderId, skippedKey.sequenceNumber, messageKeyHex, skippedKey.decryptionAttempts || 0]
  );
};

export const getSkippedGroupKey = async (groupId: string, senderId: string, sequenceNumber: number): Promise<SkippedGroupKey | null> => {
  const db = await initGroupSessionDB();
  const result = await db.getFirstAsync<{
    groupId: string;
    senderId: string;
    sequenceNumber: number;
    messageKey: string;
    decryptionAttempts: number;
  }>('SELECT * FROM skipped_group_keys WHERE groupId = ? AND senderId = ? AND sequenceNumber = ?', [groupId, senderId, sequenceNumber]);

  if (!result) return null;

  return {
    groupId: result.groupId,
    senderId: result.senderId,
    sequenceNumber: result.sequenceNumber,
    messageKey: new Uint8Array(Buffer.from(result.messageKey, 'hex')),
    decryptionAttempts: result.decryptionAttempts,
  };
};

export const deleteSkippedGroupKey = async (groupId: string, senderId: string, sequenceNumber: number): Promise<void> => {
  const db = await initGroupSessionDB();
  await db.runAsync(
    'DELETE FROM skipped_group_keys WHERE groupId = ? AND senderId = ? AND sequenceNumber = ?',
    [groupId, senderId, sequenceNumber]
  );
};

/**
 * Increment the strike counter for a poison key and evict if threshold reached.
 * @returns true if the key was scrubbed (threshold reached), false otherwise.
 */
export const recordFailedDecryptionAttempt = async (groupId: string, senderId: string, sequenceNumber: number): Promise<boolean> => {
  const key = await getSkippedGroupKey(groupId, senderId, sequenceNumber);
  if (!key) return false;

  const attempts = key.decryptionAttempts + 1;
  if (attempts >= 3) {
    console.warn(`🛡️ [Poison-Key Gate]: Scrubbing unrecoverable key for seq ${sequenceNumber} after 3 failures.`);
    await deleteSkippedGroupKey(groupId, senderId, sequenceNumber);
    return true; // Key was scrubbed
  } else {
    key.decryptionAttempts = attempts;
    await saveSkippedGroupKey(key);
    return false; // Key updated, not scrubbed yet
  }
};
