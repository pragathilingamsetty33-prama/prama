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
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
      if (err) return reject(err);

      const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
      const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

      resolve({ publicKey: publicKeyPem, privateKey: privateKeyPem });
    });
  });
};

import { argon2id } from 'hash-wasm';

/**
 * Derive a 256‑bit symmetric key from a password using Argon2id (Web).
 * Returns a Uint8Array (raw key).
 */
export const deriveKeyFromPassword = async (password: string, saltStr: string): Promise<Uint8Array> => {
  const hash = await argon2id({
    password,
    salt: saltStr,
    parallelism: 2,
    iterations: 4, 
    memorySize: 65536, // 64MiB
    hashLength: 32,
    outputType: 'binary',
  });
  return new Uint8Array(hash);
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

  return {
    iv: forge.util.encode64(iv),
    cipherText: forge.util.encode64(cipher.output.getBytes()),
    tag: forge.util.encode64(cipher.mode.tag.getBytes()),
  };
};

/**
 * Decrypt data using the symmetric key (AES‑GCM).
 */
export const decryptDataWithPassword = (encryptedData: any, derivedKey: Uint8Array): string => {
  const { iv, cipherText, tag } = encryptedData;
  const derivedBuffer = forge.util.createBuffer(Buffer.from(derivedKey));
  const decipher = forge.cipher.createDecipher('AES-GCM', derivedBuffer);

  decipher.start({
    iv: forge.util.decode64(iv),
    tag: forge.util.createBuffer(forge.util.decode64(tag)),
  });
  decipher.update(forge.util.createBuffer(forge.util.decode64(cipherText)));
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

export const decryptMessageWithAES = (encryptedData: any, aesKey: string) => {
    const cipherTxt = encryptedData.ciphertext || encryptedData.cipherText;
    const { iv, tag } = encryptedData;
    const decipher = forge.cipher.createDecipher('AES-GCM', aesKey);
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
