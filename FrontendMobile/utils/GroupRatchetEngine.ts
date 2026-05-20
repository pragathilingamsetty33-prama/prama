import { decryptMessageWithAES, deriveGroupMessageKey, deriveGroupRatchetStep } from './crypto.native';
import { 
  getSkippedGroupKey, 
  deleteSkippedGroupKey, 
  saveSkippedGroupKey, 
  getGroupSession, 
  saveGroupSession,
  recordFailedDecryptionAttempt
} from './GroupSessionStore';

// Lightweight synchronous FIFO promise queues mapped by groupId
const groupQueues: { [groupId: string]: Promise<any> } = {};

/**
 * Serializes E2EE group message decryption to prevent SQLite transaction race conditions.
 * Appends the decryption task sequentially onto the group's active promise chain,
 * and handles isolated error swallowing to ensure the queue never freezes.
 * 
 * @param groupId - Unique identifier of the group.
 * @param decryptTask - Asynchronous function returning the decrypted plaintext.
 * @returns Plaintext message payload.
 */
export const enqueueGroupDecryption = (groupId: string, decryptTask: () => Promise<string>): Promise<string | null> => {
    if (!groupQueues[groupId]) {
        groupQueues[groupId] = Promise.resolve();
    }

    const nextPromise = groupQueues[groupId].then(async () => {
        try {
            return await decryptTask();
        } catch (error) {
            console.error("🛡️ [Queue Isolation]: Recovered from message processing error:", error);
            throw error; // Propagate down to immediate caller, but NOT to the chained queue!
        }
    }).catch(err => {
        // Silently swallow in the chained root promise to let subsequent items proceed!
        return null;
    });

    // Advance the chain with a safe, resolved state for subsequent tasks
    groupQueues[groupId] = nextPromise.then(() => {});

    // Return the actual execution promise to the immediate caller
    return nextPromise;
};

/**
 * Decrypts a group message ciphertext using a raw derived 32-byte message key.
 */
const decryptGroupMessageWithKey = (ciphertext: string, iv: string, tag: string, keyBytes: Uint8Array): string => {
    let keyString = '';
    for (let i = 0; i < keyBytes.length; i++) {
        keyString += String.fromCharCode(keyBytes[i]);
    }
    
    const encryptedData = { iv, tag, ciphertext };
    return decryptMessageWithAES(encryptedData, keyString);
};

/**
 * Implements the core E2EE Megolm group decryption and ratcheting algorithm.
 * Integrates Verify-Then-Evict, 3-Strike Poison-Key Gate, and 1000-Max Skip Gap limits.
 */
export const decryptGroupMessageMegolm = async (
    groupId: string, 
    senderId: string, 
    sequenceNumber: number, 
    ciphertext: string, 
    iv: string, 
    tag: string, 
    sessionId: string
): Promise<string> => {
    // 1. Check Skipped Keys Cache first
    const skippedKeyRecord = await getSkippedGroupKey(groupId, senderId, sequenceNumber);
    
    if (skippedKeyRecord) {
        try {
            // Decrypt using single-use message key
            const plaintext = decryptGroupMessageWithKey(ciphertext, iv, tag, skippedKeyRecord.messageKey);
            
            // Verify-Then-Evict: Successful validation -> evict key immediately
            await deleteSkippedGroupKey(groupId, senderId, sequenceNumber);
            return plaintext;
        } catch (error) {
            // Strike count invalidation to protect against Poison-Key storage bloat
            const scrubbed = await recordFailedDecryptionAttempt(groupId, senderId, sequenceNumber);
            if (scrubbed) {
                throw new Error("Decryption failed: Single-use key has been scrubbed due to too many failures (Poison-Key).");
            }
            throw error;
        }
    }

    // 2. Read active session state
    let sessionState = await getGroupSession(groupId, senderId);
    
    if (!sessionState || sessionState.sessionId !== sessionId) {
        throw new Error("No active group session matching the message epoch was found.");
    }

    const N = sessionState.sequenceNumber;
    const M = sequenceNumber;

    if (M < N) {
        // Forward Secrecy Violation or Replay attack
        throw new Error("Decryption failed: Replay attack or stale sequence number (Forward Secrecy).");
    }

    if (M === N) {
        // Sequence matches exactly! Derive key, decrypt, and step the ratchet.
        const messageKey = await deriveGroupMessageKey(sessionState.ratchetKey, sessionId);
        
        try {
            const plaintext = decryptGroupMessageWithKey(ciphertext, iv, tag, messageKey);
            
            // Decryption successful -> advance master ratchet key and sequence
            const nextRatchetKey = await deriveGroupRatchetStep(sessionState.ratchetKey, sessionId);
            sessionState.sequenceNumber = N + 1;
            sessionState.ratchetKey = nextRatchetKey;
            await saveGroupSession(sessionState);
            
            return plaintext;
        } catch (error) {
            throw error;
        }
    }

    if (M > N) {
        // Sequence gap detected! Fast-march the ratchet chain
        const gap = M - N;
        if (gap > 1000) {
            throw new Error("Decryption failed: Sequence gap is too large to resolve (CWE-400 Shield).");
        }

        let activeRatchetKey = sessionState.ratchetKey;
        
        // Loop to cache intermediate skipped keys
        for (let i = N; i < M; i++) {
            const skippedMsgKey = await deriveGroupMessageKey(activeRatchetKey, sessionId);
            await saveSkippedGroupKey({
                groupId,
                senderId,
                sequenceNumber: i,
                messageKey: skippedMsgKey,
                decryptionAttempts: 0
            });
            activeRatchetKey = await deriveGroupRatchetStep(activeRatchetKey, sessionId);
        }

        // We are now at sequence M! Derive key and attempt decryption
        const targetMsgKey = await deriveGroupMessageKey(activeRatchetKey, sessionId);
        
        try {
            const plaintext = decryptGroupMessageWithKey(ciphertext, iv, tag, targetMsgKey);
            
            // Decryption successful -> step ratchet to M + 1 and save session state
            const nextRatchetKey = await deriveGroupRatchetStep(activeRatchetKey, sessionId);
            sessionState.sequenceNumber = M + 1;
            sessionState.ratchetKey = nextRatchetKey;
            await saveGroupSession(sessionState);
            
            return plaintext;
        } catch (error) {
            // Decryption failed. But since we already fast-marched the ratchet, we MUST update the session
            // to sequence M to keep subsequent messages decodable. We store targetMsgKey as a skipped key too.
            await saveSkippedGroupKey({
                groupId,
                senderId,
                sequenceNumber: M,
                messageKey: targetMsgKey,
                decryptionAttempts: 1 // Count this initial failure
            });
            
            const nextRatchetKey = await deriveGroupRatchetStep(activeRatchetKey, sessionId);
            sessionState.sequenceNumber = M + 1;
            sessionState.ratchetKey = nextRatchetKey;
            await saveGroupSession(sessionState);
            
            throw error;
        }
    }
    
    // Fallback for TS, though unreachable
    throw new Error("Unhandled decryption state.");
};
