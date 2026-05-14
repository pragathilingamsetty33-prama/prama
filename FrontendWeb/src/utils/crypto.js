import forge from 'node-forge';
import { Buffer } from 'buffer';
import { argon2id } from 'hash-wasm';

// Ensure Buffer is available
if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
    window.Buffer = Buffer;
}

/**
 * Generate a new RSA Key Pair (2048 bit).
 */
export const generateRSAKeyPair = async () => {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
            if (err) return reject(err);

            const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
            const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

            resolve({ publicKey: publicKeyPem, privateKey: privateKeyPem });
        });
    });
};

/**
 * Derive a 256‑bit symmetric key from a password using Argon2id.
 * Returns a Uint8Array (raw key).
 */
export const deriveKeyFromPassword = async (password, saltStr) => {
    const hash = await argon2id({
        password,
        salt: saltStr,
        parallelism: 2,
        iterations: 4,
        memorySize: 65536,
        hashLength: 32,
        outputType: 'binary'
    });
    return hash;
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

    return {
        iv: forge.util.encode64(iv),
        ciphertext: forge.util.encode64(cipher.output.getBytes()),
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
    if (!pkg || typeof pkg !== 'object' || !pkg.iv || !pkg.ciphertext || !pkg.tag) {
        throw new Error('Invalid encrypted package format in decryptDataWithPassword');
    }
    const { iv, ciphertext, tag } = pkg;
    const derivedBuffer = forge.util.createBuffer(Buffer.from(derivedKey));
    const decipher = forge.cipher.createDecipher('AES-GCM', derivedBuffer);
    decipher.start({
        iv: forge.util.decode64(iv),
        tag: forge.util.createBuffer(forge.util.decode64(tag)),
    });
    decipher.update(forge.util.createBuffer(forge.util.decode64(ciphertext)));
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

export const encryptFileWithAES = (arrayBuffer, aesKey) => {
    const iv = forge.random.getBytesSync(12);
    const cipher = forge.cipher.createCipher('AES-GCM', aesKey);
    cipher.start({ iv });
    cipher.update(forge.util.createBuffer(Buffer.from(arrayBuffer)));
    cipher.finish();
    return {
        iv: forge.util.encode64(iv),
        ciphertext: forge.util.encode64(cipher.output.getBytes()),
        tag: forge.util.encode64(cipher.mode.tag.getBytes())
    };
};

export const decryptFileWithAES = (encryptedData, aesKey) => {
    const { iv, ciphertext, tag } = encryptedData;
    const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
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
    throw new Error('Failed to decrypt file - authentication tag mismatch');
};

