export function generateRSAKeyPair(): Promise<{ publicKey: string; privateKey: string }>;
export function deriveKeyFromPassword(password: string, saltStr: string): Promise<Uint8Array>;
export function encryptDataWithPassword(dataString: string, derivedKey: Uint8Array): {
  iv: string;
  cipherText: string;
  tag: string;
};
export function decryptDataWithPassword(encryptedData: any, derivedKey: Uint8Array): string;
export function generateAESKey(): string;
export function encryptAESKeyWithRSA(aesKey: string, publicKeyPem: string): string;
export function decryptAESKeyWithRSA(encryptedAESKey64: string, privateKeyPem: string): string;
export function encryptMessageWithAES(message: string, aesKey: string): {
  iv: string;
  ciphertext: string;
  tag: string;
};
export function decryptMessageWithAES(encryptedData: any, aesKey: string): string;
export function encryptFileWithAES(arrayBuffer: ArrayBuffer, aesKey: string): {
  iv: string;
  ciphertext: string;
  tag: string;
};
export function decryptFileWithAES(encryptedData: any, aesKey: any, aad?: string): ArrayBuffer;
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length?: number): Uint8Array;
export function deriveGroupRatchetStep(ratchetKey: Uint8Array, sessionId: string): Promise<Uint8Array>;
export function deriveGroupMessageKey(ratchetKey: Uint8Array, sessionId: string): Promise<Uint8Array>;
