import forge from 'node-forge';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Shim Buffer for forge
if (typeof global.Buffer === 'undefined') {
  (global as any).Buffer = Buffer;
}

/**
 * Generate a new RSA Key Pair (2048 bit).
 */
export const generateRSAKeyPair = async (): Promise<{ publicKey: string; privateKey: string }> => {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err: any, keypair: any) => {
      if (err) return reject(err);

      const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
      const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

      resolve({ publicKey: publicKeyPem, privateKey: privateKeyPem });
    });
  });
};

import argon2 from 'react-native-argon2';

/**
 * Derives a 256-bit symmetric MasterKey from the user's password and UUID salt via JNI C++ kernels.
 * Aligns perfectly with the Web client's byte-array salt normalization layout.
 */
export const deriveKeyFromPassword = async (password: string, userId: string): Promise<Uint8Array> => {
    if (!password || !userId) {
        throw new Error("Missing parameters for native key derivation.");
    }

    // Surgical Fix: Match the Web client exactly by stripping hyphens from the UUID string
    const standardizedSaltHex = userId.replace(/-/g, '').toLowerCase();

    // Convert to a raw hex string representation recognized uniformly across the JNI C++ boundary
    const saltBuffer = Buffer.from(standardizedSaltHex, 'hex');
    const saltStringForNative = saltBuffer.toString('binary');

    const result = await argon2(password, saltStringForNative, {
        mode: 'argon2id',
        iterations: 3,
        memory: 64, // 64MB matches memorySize 65536
        parallelism: 4,
        hashLength: 32
    });

    if (!result || !result.rawHash) {
        throw new Error("Native KDF derivation failure: check JNI bridge logs.");
    }

    // Convert hex string output from native module back into a clean Uint8Array
    const rawHashBuffer = Buffer.from(result.rawHash, 'hex');
    return new Uint8Array(rawHashBuffer);
};

/**
 * Encrypt data with a pre‑derived symmetric key (AES‑GCM).
 */
export const encryptDataWithPassword = (dataString: string, derivedKey: Uint8Array) => {
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
    cipherText: ciphertextBase64, // Keep for legacy mobile local compatibility
    tag: forge.util.encode64(cipher.mode.tag.getBytes()),
  };
};

/**
 * Decrypt data using the symmetric key (AES‑GCM).
 */
export const decryptDataWithPassword = (encryptedData: any, derivedKey: Uint8Array): string => {
  // Handle both web format (lowercase 'ciphertext') and mobile format (camelCase 'cipherText')
  const iv = encryptedData.iv;
  const tag = encryptedData.tag;
  const cipherTextData = encryptedData.cipherText || encryptedData.ciphertext;
  
  if (!iv || !tag || !cipherTextData) {
    throw new Error('Invalid encrypted package format: missing iv, tag, or ciphertext');
  }

  const derivedBuffer = forge.util.createBuffer(Buffer.from(derivedKey));
  const decipher = forge.cipher.createDecipher('AES-GCM', derivedBuffer);

  decipher.start({
    iv: forge.util.decode64(iv),
    tag: forge.util.createBuffer(forge.util.decode64(tag)),
  });
  decipher.update(forge.util.createBuffer(forge.util.decode64(cipherTextData)));
  const pass = decipher.finish();

  if (!pass) throw new Error('Decryption failed: Incorrect password or corrupted data.');

  return decipher.output.toString('utf8');
};

/**
 * RSA-AES helpers for E2EE Messaging
 */
export const generateAESKey = () => forge.random.getBytesSync(32);

export const encryptAESKeyWithRSA = (aesKey: string, publicKeyPem: string) => {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    const encryptedKey = publicKey.encrypt(aesKey, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: { md: forge.md.sha1.create() }
    });
    return forge.util.encode64(encryptedKey);
};

export const decryptAESKeyWithRSA = (encryptedAESKey64: string, privateKeyPem: string) => {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const encryptedKey = forge.util.decode64(encryptedAESKey64);
    return privateKey.decrypt(encryptedKey, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
        mgf1: { md: forge.md.sha1.create() }
    });
};

export const encryptMessageWithAES = (message: string, aesKey: string) => {
    const iv = forge.random.getBytesSync(12);
    const keyBuffer = forge.util.createBuffer(Buffer.from(aesKey, typeof aesKey === 'string' && aesKey.length !== 32 ? 'base64' : 'binary'));
    const cipher = forge.cipher.createCipher('AES-GCM', keyBuffer);
    cipher.start({ iv });
    cipher.update(forge.util.createBuffer(message, 'utf8'));
    cipher.finish();
    return {
        iv: forge.util.encode64(iv),
        ciphertext: forge.util.encode64(cipher.output.getBytes()),
        tag: forge.util.encode64(cipher.mode.tag.getBytes())
    };
};

export const decryptMessageWithAES = (encryptedData: any, aesKey: string) => {
    // In chat app it was saved as cipherText or ciphertext depending on platform, normalize:
    const cipherTxt = encryptedData.ciphertext || encryptedData.cipherText;
    const { iv, tag } = encryptedData;
    // Normalize key: handle both string and buffer/Uint8Array
    const keyBuffer = forge.util.createBuffer(Buffer.from(aesKey, typeof aesKey === 'string' && aesKey.length !== 32 ? 'base64' : 'binary'));
    
    const decipher = forge.cipher.createDecipher('AES-GCM', keyBuffer);
    decipher.start({
        iv: forge.util.decode64(iv),
        tag: forge.util.createBuffer(forge.util.decode64(tag))
    });
    decipher.update(forge.util.createBuffer(forge.util.decode64(cipherTxt)));
    if (decipher.finish()) {
        return forge.util.decodeUtf8(decipher.output.getBytes());
    }
    throw new Error('Failed to decrypt message - authentication tag mismatch');
};
export const encryptFileWithAES = (arrayBuffer: ArrayBuffer, aesKey: string) => {
    const iv = forge.random.getBytesSync(12);
    const keyBuffer = forge.util.createBuffer(Buffer.from(aesKey, typeof aesKey === 'string' && aesKey.length !== 32 ? 'base64' : 'binary'));
    const cipher = forge.cipher.createCipher('AES-GCM', keyBuffer);
    cipher.start({ iv });
    cipher.update(forge.util.createBuffer(Buffer.from(arrayBuffer)));
    cipher.finish();
    return {
        iv: forge.util.encode64(iv),
        ciphertext: forge.util.encode64(cipher.output.getBytes()),
        tag: forge.util.encode64(cipher.mode.tag.getBytes())
    };
};

export const decryptFileWithAES = (encryptedData: any, aesKey: any, aad?: string) => {
    const { iv, ciphertext, tag } = encryptedData;
    
    // Normalize key: handle both base64 string and raw binary
    const keyBuffer = forge.util.createBuffer(Buffer.from(aesKey, typeof aesKey === 'string' && aesKey.length !== 32 ? 'base64' : 'binary'));

    const decipher = forge.cipher.createDecipher('AES-GCM', keyBuffer);
    
    const startParams: any = {
        iv: forge.util.decode64(iv),
        tag: forge.util.createBuffer(forge.util.decode64(tag))
    };
    if (aad) {
        startParams.additionalData = aad;
    }

    decipher.start(startParams);
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

/**
 * Internal HKDF-SHA-256 derivation engine using node-forge HMAC.
 * Matches WebCrypto extraction and 1-block expansion exactly to the byte.
 */
export const hkdfSha256 = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number = 32): Uint8Array => {
    const hmacPrk = forge.hmac.create();
    hmacPrk.start('sha256', forge.util.createBuffer(Buffer.from(salt)));
    hmacPrk.update(forge.util.createBuffer(Buffer.from(ikm)));
    const prk = hmacPrk.digest().getBytes();

    const hmacExp = forge.hmac.create();
    hmacExp.start('sha256', forge.util.createBuffer(prk));
    hmacExp.update(forge.util.createBuffer(Buffer.from(info)));
    hmacExp.update(forge.util.createBuffer(new Uint8Array([1])));
    const t1 = hmacExp.digest().getBytes();

    const result = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        result[i] = t1.charCodeAt(i);
    }
    return result;
};

/**
 * Steps the 256-bit group session ratchet key forward using HKDF-SHA-256.
 */
export const deriveGroupRatchetStep = async (ratchetKey: Uint8Array, sessionId: string): Promise<Uint8Array> => {
    const salt = Buffer.from(sessionId, 'utf8');
    const info = Buffer.from("PramaGroupRatchetStep", 'utf8');
    return hkdfSha256(ratchetKey, salt, info, 32);
};

/**
 * Derives a dedicated single-use message encryption key from the active ratchet key.
 */
export const deriveGroupMessageKey = async (ratchetKey: Uint8Array, sessionId: string): Promise<Uint8Array> => {
    const salt = Buffer.from(sessionId, 'utf8');
    const info = Buffer.from("PramaGroupMessageKey", 'utf8');
    return hkdfSha256(ratchetKey, salt, info, 32);
};
