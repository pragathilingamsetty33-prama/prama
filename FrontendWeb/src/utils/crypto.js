import forge from 'node-forge';
import { Buffer } from 'buffer';
import { argon2id } from 'hash-wasm';
import { 
    getSkippedGroupKey, 
    saveSkippedGroupKey, 
    deleteSkippedGroupKey, 
    getGroupSession, 
    saveGroupSession 
} from './storageVault';

// Ensure Buffer is available
if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
    window.Buffer = Buffer;
}

/**
 * Generate a new RSA Key Pair (2048 bit).
 */
export const generateRSAKeyPair = async () => {
    // Using synchronous generation to avoid web worker issues (prime.worker.js not found)
    const keypair = forge.pki.rsa.generateKeyPair(2048);
    
    const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
    const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

    return { publicKey: publicKeyPem, privateKey: privateKeyPem };
};

/**
 * Derives a 256-bit symmetric MasterKey from the user's password and UUID salt.
 * Standardizes the salt to a pure hex string to eliminate cross-platform string marshaling gaps.
 */
export const deriveKeyFromPassword = async (password, userId) => {
    if (!password || !userId) {
        throw new Error("Missing parameters for key derivation.");
    }

    // Surgical Fix: Strip hyphens to create a clean, uniform hex representation of the UUID
    const standardizedSaltHex = userId.replace(/-/g, '').toLowerCase();

    // Convert the hex string into a Uint8Array to ensure byte-perfect alignment with native engines
    const saltBytes = new Uint8Array(
        standardizedSaltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );

    const hashResult = await argon2id({
        password: password,
        salt: saltBytes, // Explicit byte array input avoids internal string encoding discrepancies
        iterations: 3,
        memorySize: 65536,
        parallelism: 4,
        hashLength: 32, // 256-bit key output
        outputType: 'binary'
    });

    return hashResult;
};


/**
 * Encrypt data with a pre‑derived symmetric key (AES‑GCM).
 */
export const encryptDataWithPassword = (dataString, derivedKey) => {
    const iv = forge.random.getBytesSync(12);
    const derivedBuffer = forge.util.createBuffer(Buffer.from(derivedKey));
    const cipher = forge.cipher.createCipher('AES-GCM', derivedBuffer);
    cipher.start({ iv });
    cipher.update(forge.util.createBuffer(dataString, 'utf8'));
    cipher.finish();

    const ciphertextBase64 = forge.util.encode64(cipher.output.getBytes());
    return {
        iv: forge.util.encode64(iv),
        ciphertext: ciphertextBase64,
        cipherText: ciphertextBase64, // Keep for cross-platform fallback compatibility
        tag: forge.util.encode64(cipher.mode.tag.getBytes()),
    };
};

/**
 * Decrypt data with a pre‑derived symmetric key.
 */
export const decryptDataWithPassword = (encryptedPackage, derivedKey) => {
    let pkg = encryptedPackage;
    if (typeof pkg === 'string') {
        try { pkg = JSON.parse(pkg); } catch(e) {}
    }
    const iv = pkg?.iv;
    const tag = pkg?.tag;
    const cipherTextData = pkg?.ciphertext || pkg?.cipherText;

    if (!pkg || typeof pkg !== 'object' || !iv || !tag || !cipherTextData) {
        throw new Error('Invalid encrypted package format in decryptDataWithPassword');
    }

    const derivedBuffer = forge.util.createBuffer(Buffer.from(derivedKey));
    const decipher = forge.cipher.createDecipher('AES-GCM', derivedBuffer);
    decipher.start({
        iv: forge.util.decode64(iv),
        tag: forge.util.createBuffer(forge.util.decode64(tag)),
    });
    decipher.update(forge.util.createBuffer(forge.util.decode64(cipherTextData)));
    const pass = decipher.finish();
    if (pass) {
        return forge.util.decodeUtf8(decipher.output.getBytes());
    }
    throw new Error('Failed to decrypt data – incorrect key or tampered data');
};

/**
 * RSA-AES helpers
 */
export const generateAESKey = () => forge.random.getBytesSync(32);

export const encryptAESKeyWithRSA = (aesKey, publicKeyPem) => {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    const encryptedKey = publicKey.encrypt(aesKey, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: { md: forge.md.sha1.create() }
    });
    return forge.util.encode64(encryptedKey);
};

export const decryptAESKeyWithRSA = (encryptedAESKey64, privateKeyPem) => {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const encryptedKey = forge.util.decode64(encryptedAESKey64);
    return privateKey.decrypt(encryptedKey, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: { md: forge.md.sha1.create() }
    });
};

export const encryptMessageWithAES = (message, aesKey) => {
    const iv = forge.random.getBytesSync(12);
    const cipher = forge.cipher.createCipher('AES-GCM', aesKey);
    cipher.start({ iv });
    cipher.update(forge.util.createBuffer(message, 'utf8'));
    cipher.finish();
    return {
        iv: forge.util.encode64(iv),
        ciphertext: forge.util.encode64(cipher.output.getBytes()),
        tag: forge.util.encode64(cipher.mode.tag.getBytes())
    };
};

export const decryptMessageWithAES = (encryptedData, aesKey) => {
    if (!encryptedData || typeof encryptedData !== 'object' || !encryptedData.iv || !encryptedData.tag || !encryptedData.ciphertext) {
        throw new Error('Invalid encrypted data format (missing iv, tag, or ciphertext)');
    }
    const { iv, ciphertext, tag } = encryptedData;
    const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
    decipher.start({
        iv: forge.util.decode64(iv),
        tag: forge.util.createBuffer(forge.util.decode64(tag))
    });
    decipher.update(forge.util.createBuffer(forge.util.decode64(ciphertext)));
    if (decipher.finish()) {
        return forge.util.decodeUtf8(decipher.output.getBytes());
    }
    throw new Error('Failed to decrypt message - authentication tag mismatch');
};

export const encryptFileWithAES = async (arrayBuffer, aesKey) => {
    let rawKeyBytes;
    if (typeof aesKey === 'string') {
        if (aesKey.length !== 32) {
            const binary = forge.util.decode64(aesKey);
            rawKeyBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                rawKeyBytes[i] = binary.charCodeAt(i);
            }
        } else {
            rawKeyBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                rawKeyBytes[i] = aesKey.charCodeAt(i);
            }
        }
    } else {
        rawKeyBytes = new Uint8Array(aesKey);
    }

    const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        rawKeyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        arrayBuffer
    );

    const unifiedBuffer = new Uint8Array(12 + encryptedBuffer.byteLength);
    unifiedBuffer.set(iv, 0);
    unifiedBuffer.set(new Uint8Array(encryptedBuffer), 12);

    return {
        unifiedBuffer: unifiedBuffer.buffer,
        iv: iv
    };
};

export const decryptFileWithAES = async (encryptedData, aesKey) => {
    let rawKeyBytes;
    if (typeof aesKey === 'string') {
        if (aesKey.length !== 32) {
            const binary = forge.util.decode64(aesKey);
            rawKeyBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                rawKeyBytes[i] = binary.charCodeAt(i);
            }
        } else {
            rawKeyBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                rawKeyBytes[i] = aesKey.charCodeAt(i);
            }
        }
    } else {
        rawKeyBytes = new Uint8Array(aesKey);
    }

    const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        rawKeyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    if (encryptedData instanceof ArrayBuffer || encryptedData instanceof Uint8Array || ArrayBuffer.isView(encryptedData)) {
        const rawBytes = encryptedData instanceof Uint8Array 
            ? encryptedData 
            : new Uint8Array(encryptedData instanceof ArrayBuffer ? encryptedData : encryptedData.buffer);
        
        const iv = rawBytes.slice(0, 12);
        const encryptedBytes = rawBytes.slice(12);

        return await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            cryptoKey,
            encryptedBytes
        );
    }

    // Legacy JSON format fallback (using forge decrypt)
    const { iv, ciphertext, tag } = encryptedData;
    const keyBuffer = forge.util.createBuffer(rawKeyBytes);
    const decipher = forge.cipher.createDecipher('AES-GCM', keyBuffer);
    decipher.start({
        iv: forge.util.decode64(iv),
        tag: forge.util.createBuffer(forge.util.decode64(tag))
    });
    decipher.update(forge.util.createBuffer(forge.util.decode64(ciphertext)));
    if (decipher.finish()) {
        const decodedBytes = decipher.output.getBytes();
        const result = new Uint8Array(decodedBytes.length);
        for (let i = 0; i < decodedBytes.length; i++) {
            result[i] = decodedBytes.charCodeAt(i);
        }
        return result.buffer;
    }
    throw new Error('Failed to decrypt legacy file - authentication tag mismatch');
};

/**
 * Deterministically reduces a file UUID string to a fast, non-cryptographic 32-bit unsigned integer (FNV-1a).
 * 
 * @param {string} fileId - The unique UUID string of the target attachment.
 * @returns {number} - Unsigned 32-bit integer hash representation.
 */
export const hashFileIdTo32Bit = (fileId) => {
    if (!fileId) return 0;
    let hash = 2166136261;
    for (let i = 0; i < fileId.length; i++) {
        hash ^= fileId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/**
 * Creates a strict 12-byte Little-Endian ArrayBuffer representation of the Indeterminate Stream AAD header.
 * 
 * @param {number} chunkIndex - The monotonic index of the active chunk.
 * @param {boolean} isEOF - Whether this chunk represents the end of the stream.
 * @param {string} fileId - The unique file ID string to bind.
 * @returns {Uint8Array} - Byte-aligned 12-byte Additional Authenticated Data array.
 */
export const create12ByteAAD = (chunkIndex, isEOF, fileId) => {
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    
    // Byte 0-3: chunkIndex (uint32, forced Little-Endian)
    view.setUint32(0, chunkIndex, true);
    
    // Byte 4-7: blockFlags (uint32, 0x01 if EOF, else 0x00, forced Little-Endian)
    const blockFlags = isEOF ? 1 : 0;
    view.setUint32(4, blockFlags, true);
    
    // Byte 8-11: fileIdHash (uint32, forced Little-Endian)
    const fileIdHash = hashFileIdTo32Bit(fileId);
    view.setUint32(8, fileIdHash, true);
    
    return new Uint8Array(buffer);
};

/**
 * Encrypts a uniform 1 MB chunk using WebCrypto AES-GCM and binds sequence + file context into a 12-byte AAD envelope.
 * 
 * @param {ArrayBuffer} chunkBuffer - Raw chunk payload bytes.
 * @param {string|Uint8Array} aesKey - The 256-bit symmetric key.
 * @param {number} chunkIndex - Monotonic index of this segment.
 * @param {boolean} isEOF - Flag indicating last chunk in transfer.
 * @param {string} fileId - Parent attachment identity UUID.
 * @returns {Promise<ArrayBuffer>} - Unified container: [12-byte IV][ciphertext][16-byte tag].
 */
export const encryptChunkWithAESGCM = async (chunkBuffer, aesKey, chunkIndex, isEOF, fileId) => {
    let rawKeyBytes;
    if (typeof aesKey === 'string') {
        if (aesKey.length !== 32) {
            const binary = forge.util.decode64(aesKey);
            rawKeyBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                rawKeyBytes[i] = binary.charCodeAt(i);
            }
        } else {
            rawKeyBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                rawKeyBytes[i] = aesKey.charCodeAt(i);
            }
        }
    } else {
        rawKeyBytes = new Uint8Array(aesKey);
    }

    const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        rawKeyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const aad = create12ByteAAD(chunkIndex, isEOF, fileId);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            additionalData: aad
        },
        cryptoKey,
        chunkBuffer
    );

    const unifiedBuffer = new Uint8Array(12 + encryptedBuffer.byteLength);
    unifiedBuffer.set(iv, 0);
    unifiedBuffer.set(new Uint8Array(encryptedBuffer), 12);

    return unifiedBuffer.buffer;
};

/**
 * Decrypts a binary chunk container, enforcing integrity authentication against sequence, truncation, and splicing threats.
 * 
 * @param {ArrayBuffer|Uint8Array} encryptedChunkBuffer - Input envelope: [12-byte IV][ciphertext][16-byte tag].
 * @param {string|Uint8Array} aesKey - The 256-bit symmetric key.
 * @param {number} chunkIndex - Monotonic index check.
 * @param {boolean} isEOF - Final block check.
 * @param {string} fileId - Parent attachment identity UUID check.
 * @returns {Promise<ArrayBuffer>} - Plaintext decrypted chunk bytes.
 */
export const decryptChunkWithAESGCM = async (encryptedChunkBuffer, aesKey, chunkIndex, isEOF, fileId) => {
    let rawKeyBytes;
    if (typeof aesKey === 'string') {
        if (aesKey.length !== 32) {
            const binary = forge.util.decode64(aesKey);
            rawKeyBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                rawKeyBytes[i] = binary.charCodeAt(i);
            }
        } else {
            rawKeyBytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
                rawKeyBytes[i] = aesKey.charCodeAt(i);
            }
        }
    } else {
        rawKeyBytes = new Uint8Array(aesKey);
    }

    const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        rawKeyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    const rawBytes = encryptedChunkBuffer instanceof Uint8Array
        ? encryptedChunkBuffer
        : new Uint8Array(encryptedChunkBuffer instanceof ArrayBuffer ? encryptedChunkBuffer : encryptedChunkBuffer.buffer);

    if (rawBytes.byteLength < 28) {
        throw new Error('Encrypted chunk container is corrupted or too short.');
    }

    const iv = rawBytes.slice(0, 12);
    const encryptedPayload = rawBytes.slice(12);
    const aad = create12ByteAAD(chunkIndex, isEOF, fileId);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            additionalData: aad
        },
        cryptoKey,
        encryptedPayload
    );

    return decryptedBuffer;
};

/**
 * Steps the 256-bit group session ratchet key forward using HKDF-SHA-256 (WebCrypto).
 * 
 * @param {Uint8Array} ratchetKey - The current active 32-byte ratchet key.
 * @param {string} sessionId - The group session identity salt.
 * @returns {Promise<Uint8Array>} - The next 32-byte ratchet key.
 */
export const deriveGroupRatchetStep = async (ratchetKey, sessionId) => {
    const baseKey = await window.crypto.subtle.importKey(
        "raw",
        ratchetKey,
        "HKDF",
        false,
        ["deriveBits"]
    );
    const encoder = new TextEncoder();
    const salt = encoder.encode(sessionId);
    const info = encoder.encode("PramaGroupRatchetStep");

    const derivedBuffer = await window.crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: salt,
            info: info
        },
        baseKey,
        256
    );
    return new Uint8Array(derivedBuffer);
};

/**
 * Derives a dedicated single-use message encryption key from the active ratchet key.
 * 
 * @param {Uint8Array} ratchetKey - The active 32-byte ratchet key.
 * @param {string} sessionId - The group session identity salt.
 * @returns {Promise<Uint8Array>} - The derived 32-byte message encryption key.
 */
export const deriveGroupMessageKey = async (ratchetKey, sessionId) => {
    const baseKey = await window.crypto.subtle.importKey(
        "raw",
        ratchetKey,
        "HKDF",
        false,
        ["deriveBits"]
    );
    const encoder = new TextEncoder();
    const salt = encoder.encode(sessionId);
    const info = encoder.encode("PramaGroupMessageKey");

    const derivedBuffer = await window.crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: salt,
            info: info
        },
        baseKey,
        256
    );
    return new Uint8Array(derivedBuffer);
};

/**
 * Decrypts a group message ciphertext using a raw derived 32-byte message key.
 */
export const decryptGroupMessageWithKey = (ciphertext, iv, tag, keyBytes) => {
    let keyString = '';
    for (let i = 0; i < keyBytes.length; i++) {
        keyString += String.fromCharCode(keyBytes[i]);
    }
    
    const encryptedData = { iv, tag, ciphertext };
    return decryptMessageWithAES(encryptedData, keyString);
};

// Lightweight synchronous FIFO promise queues mapped by groupId
const groupQueues = {};

/**
 * Serializes E2EE group message decryption to prevent transaction race conditions in IndexedDB.
 * Appends the decryption task sequentially onto the group's active promise chain,
 * and handles isolated error swallowing to ensure the queue never freezes.
 * 
 * @param {string} groupId - Unique identifier of the group.
 * @param {Function} decryptTask - Asynchronous function returning the decrypted plaintext.
 * @returns {Promise<string>} - Plaintext message payload.
 */
export const enqueueGroupDecryption = (groupId, decryptTask) => {
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
 * Implements the core E2EE Megolm group decryption and ratcheting algorithm.
 * Integrates Verify-Then-Evict, 3-Strike Poison-Key Gate, and 1000-Max Skip Gap limits.
 */
export const decryptGroupMessageMegolm = async (db, groupId, senderId, sequenceNumber, ciphertext, iv, tag, sessionId) => {
    // 1. Check Skipped Keys Cache first
    const skippedKeyRecord = await getSkippedGroupKey(db, groupId, senderId, sequenceNumber);
    
    if (skippedKeyRecord) {
        try {
            // Decrypt using single-use message key
            const plaintext = decryptGroupMessageWithKey(ciphertext, iv, tag, skippedKeyRecord.messageKey);
            
            // Verify-Then-Evict: Successful validation -> evict key immediately
            await deleteSkippedGroupKey(db, groupId, senderId, sequenceNumber);
            return plaintext;
        } catch (error) {
            // Strike count invalidation to protect against Poison-Key storage bloat
            const attempts = (skippedKeyRecord.decryptionAttempts || 0) + 1;
            if (attempts >= 3) {
                console.warn(`🛡️ [Poison-Key Gate]: Scrubbing unrecoverable key for seq ${sequenceNumber} after 3 failures.`);
                await deleteSkippedGroupKey(db, groupId, senderId, sequenceNumber);
                throw new Error("Decryption failed: Single-use key has been scrubbed due to too many failures (Poison-Key).");
            } else {
                skippedKeyRecord.decryptionAttempts = attempts;
                await saveSkippedGroupKey(db, skippedKeyRecord);
                throw error;
            }
        }
    }

    // 2. Read active session state
    let sessionState = await getGroupSession(db, groupId, senderId);
    
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
            await saveGroupSession(db, sessionState);
            
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
            await saveSkippedGroupKey(db, {
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
            await saveGroupSession(db, sessionState);
            
            return plaintext;
        } catch (error) {
            // Decryption failed. But since we already fast-marched the ratchet, we MUST update the session
            // to sequence M to keep subsequent messages decodable. We store targetMsgKey as a skipped key too.
            await saveSkippedGroupKey(db, {
                groupId,
                senderId,
                sequenceNumber: M,
                messageKey: targetMsgKey,
                decryptionAttempts: 1 // Count this initial failure
            });
            
            const nextRatchetKey = await deriveGroupRatchetStep(activeRatchetKey, sessionId);
            sessionState.sequenceNumber = M + 1;
            sessionState.ratchetKey = nextRatchetKey;
            await saveGroupSession(db, sessionState);
            
            throw error;
        }
    }
};


