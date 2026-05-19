/**
 * Safely persists a wrapped E2EE key bundle to localStorage using an append-only version slot.
 * Enforces a strict Sliding-Window Pruning Rule (MAX_VERSIONS = 3) to prevent browser quota exhaustion.
 * Excludes critical authentication keys and the target key from eviction.
 * 
 * @param {string} userId - The unique user UUID string.
 * @param {number} version - The cryptographic vault version epoch to save.
 * @param {object|string} keyBundle - The wrapped/encrypted RSA key pair payload.
 */
export const saveVersionedKeysWeb = (userId, version, keyBundle) => {
    if (!userId || !version || !keyBundle) {
        throw new Error("Invalid parameters for versioned key persistence.");
    }

    const prefix = `rsaKeys_${userId}_v`;
    const targetKey = `${prefix}${version}`;
    const stringifiedBundle = typeof keyBundle === 'string' ? keyBundle : JSON.stringify(keyBundle);

    try {
        // 1. Collect and parse all current versioned slots for this user
        const historicalVersions = [];
        for (let i = 0; i < localStorage.length; i++) {
            const currentKey = localStorage.key(i);
            if (currentKey && currentKey.startsWith(prefix)) {
                const versionNumber = parseInt(currentKey.replace(prefix, ''), 10);
                if (!isNaN(versionNumber)) {
                    historicalVersions.push({ key: currentKey, version: versionNumber });
                }
            }
        }

        // 2. Enforce the Sliding Window: Max structural depth capped at 3
        // Surgical Fix: Filter out the active targetKey since overwriting it won't increase the total slot count
        const distinctHistorical = historicalVersions.filter(v => v.key !== targetKey);

        if (distinctHistorical.length >= 3) {
            // Sort ascending to target the oldest historical version in memory
            distinctHistorical.sort((a, b) => a.version - b.version);

            // Sequentially prune until space is cleared below the threshold boundary
            while (distinctHistorical.length >= 3) {
                const oldestArtifact = distinctHistorical.shift();
                localStorage.removeItem(oldestArtifact.key);
                console.warn(`[Storage Engine] Pruned oldest cryptographic slot to protect origin quota: ${oldestArtifact.key}`);
            }
        }

        // 3. Atomically commit the fresh cryptographic version epoch
        localStorage.setItem(targetKey, stringifiedBundle);
        
    } catch (error) {
        if (error.name === 'QuotaExceededError' || error.code === 22) {
            console.warn("⚠️ QuotaExceededError fully active. Initiating Scorched-Earth emergency identity protection.");
            
            // Essential session keys that MUST never be purged
            const protectedAuthKeys = ['prama_auth_user', 'user', 'session_pwd'];
            
            // 1. Defensively collect all non-cryptographic and non-essential keys
            const garbageKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && !key.startsWith(`rsaKeys_`) && !protectedAuthKeys.includes(key)) {
                    garbageKeys.push(key);
                }
            }
            
            // 2. Clear the trash completely to prioritize the identity layer
            garbageKeys.forEach(k => localStorage.removeItem(k));
            
            // 3. Atomically retry the final identity commit
            try {
                localStorage.setItem(targetKey, stringifiedBundle);
                return; 
            } catch (retryError) {
                console.error("❌ Critical System Failure: Safe storage manipulation fully blocked by host environment.");
            }
        }
        throw error;
    }
};

/**
 * Iterates downwards through versioned local storage slots to recover the latest functional key state.
 * 
 * @param {string} userId - The unique user UUID string.
 * @returns {number[]|null} - Prioritized array of version epochs.
 */
export const recoverLatestValidKeyWeb = (userId) => {
    if (!userId) return null;
    const prefix = `rsaKeys_${userId}_v`;
    const historicalVersions = [];

    for (let i = 0; i < localStorage.length; i++) {
        const currentKey = localStorage.key(i);
        if (currentKey && currentKey.startsWith(prefix)) {
            const versionNumber = parseInt(currentKey.replace(prefix, ''), 10);
            if (!isNaN(versionNumber)) {
                historicalVersions.push(versionNumber);
            }
        }
    }

    if (historicalVersions.length === 0) return null;

    // Sort descending to attempt restoration from the absolute freshest key snapshot first
    historicalVersions.sort((a, b) => b - a);
    return historicalVersions; // Returns prioritized array of version epochs to try decrypting
};

const DB_NAME = 'prama_vault_db';
const DB_VERSION = 3;

/**
 * Asynchronously opens the custom IndexedDB store for secure chunked file assembly.
 * 
 * @returns {Promise<IDBDatabase>} - Fully opened IndexedDB database instance.
 */
export const initVaultDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('temp_chunks')) {
                // Compound primary key to bind segments monotonically without index collision
                const store = db.createObjectStore('temp_chunks', { keyPath: ['fileId', 'chunkIndex'] });
                // High-speed index to enable safe, non-blocking startup scavenger scans
                store.createIndex('by_timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('group_sessions')) {
                db.createObjectStore('group_sessions', { keyPath: ['groupId', 'senderId'] });
            }
            if (!db.objectStoreNames.contains('skipped_group_keys')) {
                db.createObjectStore('skipped_group_keys', { keyPath: ['groupId', 'senderId', 'sequenceNumber'] });
            }
            if (!db.objectStoreNames.contains('private_keys')) {
                db.createObjectStore('private_keys', { keyPath: 'userId' });
            }
        };
        
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        
        request.onerror = (event) => {
            reject(new Error(`Failed to open prama_vault_db: ${event.target.error}`));
        };
    });
};

/**
 * Persists a decrypted segment as a disk-backed virtual Blob to limit RAM usage.
 * Resolves only when the physical I/O write complete event fires, preventing backpressure memory leaks.
 * 
 * @param {IDBDatabase} db - Opened database handle.
 * @param {string} fileId - Unique UUID string of the file.
 * @param {number} chunkIndex - Monotonic index of the active chunk.
 * @param {ArrayBuffer|Uint8Array} decryptedBuffer - Decrypted raw bytes.
 * @returns {Promise<void>} - Completion signal.
 */
export const saveChunkToIndexedDB = (db, fileId, chunkIndex, decryptedBuffer) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['temp_chunks'], 'readwrite');
        const store = transaction.objectStore('temp_chunks');
        
        // File-Backed Blob-Chunk Standard: Convert raw bytes to disk-backed virtual Blob
        const chunkBlob = new Blob([decryptedBuffer]);
        
        const record = {
            fileId,
            chunkIndex,
            data: chunkBlob,
            timestamp: Date.now()
        };
        
        store.put(record);
        
        transaction.oncomplete = () => {
            resolve();
        };
        
        transaction.onerror = (event) => {
            reject(new Error(`Failed to store chunk ${chunkIndex} for file ${fileId}: ${transaction.error}`));
        };
    });
};

/**
 * Retrieves all stored chunk-blobs for a file sequentially in a single batch transaction.
 * Returns an array of disk-backed virtual Blob references to keep heap memory locked at zero.
 * 
 * @param {IDBDatabase} db - Opened database handle.
 * @param {string} fileId - Unique UUID string of the file.
 * @returns {Promise<Blob[]>} - Array of virtual Blob chunk references in sorted order.
 */
export const getFileChunksFromIndexedDB = (db, fileId) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['temp_chunks'], 'readonly');
        const store = transaction.objectStore('temp_chunks');
        
        // Single-hop readonly Bound Range Query to pull sorted chunks with zero main-thread stutters
        const range = IDBKeyRange.bound([fileId, 0], [fileId, Infinity]);
        const request = store.getAll(range);
        
        request.onsuccess = (event) => {
            resolve(event.target.result.map(record => record.data));
        };
        
        request.onerror = (event) => {
            reject(new Error(`Failed to retrieve chunks for file ${fileId}: ${event.target.error}`));
        };
    });
};

/**
 * Deterministically sweeps all temporary chunk records associated with a file UUID.
 * 
 * @param {IDBDatabase} db - Opened database handle.
 * @param {string} fileId - Target file UUID.
 * @returns {Promise<void>} - Eviction signal.
 */
export const wipeFileChunksFromIndexedDB = (db, fileId) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['temp_chunks'], 'readwrite');
        const store = transaction.objectStore('temp_chunks');
        
        const range = IDBKeyRange.bound([fileId, 0], [fileId, Infinity]);
        const request = store.openCursor(range);
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        
        transaction.oncomplete = () => {
            resolve();
        };
        
        transaction.onerror = (event) => {
            reject(new Error(`Failed to delete chunks for file ${fileId}: ${transaction.error}`));
        };
    });
};

/**
 * Safely purges stale, orphaned chunks older than 30 minutes on startup to prevent storage leaks.
 * Leverages high-speed B-Tree index scan to fully protect active multi-tab download sessions.
 * 
 * @param {IDBDatabase} db - Opened database handle.
 * @returns {Promise<void>} - Scavenger complete signal.
 */
export const runBootGarbageCollector = (db) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['temp_chunks'], 'readwrite');
        const store = transaction.objectStore('temp_chunks');
        const timeIndex = store.index('by_timestamp');
        
        const expirationThreshold = Date.now() - (30 * 60 * 1000); // 30 minutes
        const staleRange = IDBKeyRange.upperBound(expirationThreshold);
        const request = timeIndex.openCursor(staleRange);
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        
        transaction.oncomplete = () => {
            console.log('[Storage Scavenger] Boot garbage collection sweep successfully finished.');
            resolve();
        };
        
        transaction.onerror = (event) => {
            console.error('[Storage Scavenger] Boot garbage collection sweep failed:', transaction.error);
            reject(transaction.error);
        };
    });
};

/**
 * Saves or updates a group session state.
 */
export const saveGroupSession = (db, sessionState) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['group_sessions'], 'readwrite');
        const store = transaction.objectStore('group_sessions');
        store.put(sessionState);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error(`Failed to save group session: ${transaction.error}`));
    });
};

/**
 * Retrieves the group session state for a specific sender in a group.
 */
export const getGroupSession = (db, groupId, senderId) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['group_sessions'], 'readonly');
        const store = transaction.objectStore('group_sessions');
        const request = store.get([groupId, senderId]);
        request.onsuccess = (e) => resolve(e.target.result || null);
        request.onerror = (e) => reject(new Error(`Failed to retrieve group session: ${request.error}`));
    });
};

/**
 * Saves a skipped group key.
 */
export const saveSkippedGroupKey = (db, skippedKey) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['skipped_group_keys'], 'readwrite');
        const store = transaction.objectStore('skipped_group_keys');
        store.put(skippedKey);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error(`Failed to save skipped group key: ${transaction.error}`));
    });
};

/**
 * Retrieves a skipped group key.
 */
export const getSkippedGroupKey = (db, groupId, senderId, sequenceNumber) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['skipped_group_keys'], 'readonly');
        const store = transaction.objectStore('skipped_group_keys');
        const request = store.get([groupId, senderId, sequenceNumber]);
        request.onsuccess = (e) => resolve(e.target.result || null);
        request.onerror = (e) => reject(new Error(`Failed to retrieve skipped group key: ${request.error}`));
    });
};

/**
 * Deletes a skipped group key (Verify-Then-Evict).
 */
export const deleteSkippedGroupKey = (db, groupId, senderId, sequenceNumber) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['skipped_group_keys'], 'readwrite');
        const store = transaction.objectStore('skipped_group_keys');
        store.delete([groupId, senderId, sequenceNumber]);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error(`Failed to delete skipped group key: ${transaction.error}`));
    });
};

// --- WebCrypto Key Wrapping Vault ---

/**
 * In-memory, session-bound Key Encryption Key (KEK)
 * This key is NEVER persisted to disk. It only exists in the active JavaScript execution context.
 */
let sessionBoundKEK = null;

/**
 * Initializes the ephemeral Key Encryption Key (KEK).
 */
export const initSessionKEK = async () => {
    if (!sessionBoundKEK) {
        sessionBoundKEK = await window.crypto.subtle.generateKey(
            {
                name: "AES-KW",
                length: 256,
            },
            false, // Non-extractable
            ["wrapKey", "unwrapKey"]
        );
    }
    return sessionBoundKEK;
};

/**
 * Saves a WebCrypto CryptoKey into IndexedDB by wrapping it with the in-memory KEK.
 */
export const storeWrappedPrivateKey = async (db, userId, privateCryptoKey) => {
    const kek = await initSessionKEK();
    
    // Wrap the private CryptoKey using AES-KW
    const wrappedKeyBuffer = await window.crypto.subtle.wrapKey(
        "pkcs8",
        privateCryptoKey,
        kek,
        {
            name: "AES-KW"
        }
    );

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['private_keys'], 'readwrite');
        const store = transaction.objectStore('private_keys');
        store.put({
            userId: userId,
            wrappedKey: wrappedKeyBuffer
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(new Error(`Failed to store wrapped key: ${transaction.error}`));
    });
};

/**
 * Retrieves and unwraps the private CryptoKey from IndexedDB.
 */
export const retrieveUnwrappedPrivateKey = async (db, userId) => {
    const kek = await initSessionKEK();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['private_keys'], 'readonly');
        const store = transaction.objectStore('private_keys');
        const request = store.get(userId);

        request.onsuccess = async (e) => {
            const record = e.target.result;
            if (!record) {
                return resolve(null);
            }

            try {
                // Unwrap back into a non-extractable CryptoKey
                const unwrappedKey = await window.crypto.subtle.unwrapKey(
                    "pkcs8",
                    record.wrappedKey,
                    kek,
                    {
                        name: "AES-KW"
                    },
                    {
                        name: "RSA-OAEP",
                        hash: "SHA-256"
                    },
                    false, // Non-extractable in memory
                    ["decrypt", "unwrapKey"]
                );
                resolve(unwrappedKey);
            } catch (unwrapErr) {
                reject(new Error(`Failed to unwrap private key: ${unwrapErr}`));
            }
        };

        request.onerror = (e) => reject(new Error(`Failed to retrieve wrapped key: ${request.error}`));
    });
};

