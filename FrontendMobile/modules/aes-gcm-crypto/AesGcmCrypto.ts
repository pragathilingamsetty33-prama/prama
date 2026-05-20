import 'react-native-get-random-values';
import { NativeModules, Platform } from 'react-native';

/**
 * AesGcmCrypto – TypeScript wrapper for the native AES-256-GCM streaming module.
 *
 * The underlying Android module (AesGcmCryptoModule.kt) streams file data through
 * a CipherOutputStream / CipherInputStream with an 8 KB buffer.
 * The file is NEVER loaded into memory.
 *
 * File layout on disk after encryption:
 *   [ IV (12 bytes raw) ][ ciphertext ][ GCM authentication tag (16 bytes) ]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EncryptFileResult {
  /** Base64-encoded 12-byte IV used during encryption. Store this alongside the file. */
  iv: string;
}

interface AesGcmCryptoNativeModule {
  encryptFile(
    sourceUri: string,
    destUri: string,
    keyBase64: string
  ): Promise<EncryptFileResult>;

  decryptFile(
    sourceUri: string,
    destUri: string,
    keyBase64: string,
    ivBase64: string
  ): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Native module binding
// ─────────────────────────────────────────────────────────────────────────────

const { AesGcmCrypto: _native } = NativeModules as {
  AesGcmCrypto: AesGcmCryptoNativeModule | undefined;
};

function assertNative(): AesGcmCryptoNativeModule {
  if (Platform.OS !== 'android') {
    throw new Error(
      '[AesGcmCrypto] This native module is currently Android-only. ' +
      'Use the JS crypto utilities (utils/crypto.web.ts) on other platforms.'
    );
  }
  if (!_native) {
    throw new Error(
      '[AesGcmCrypto] Native module not found. ' +
      'Make sure you have run `npx expo run:android` with a Development Build (not Expo Go).'
    );
  }
  return _native;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a file at `sourceUri` → write encrypted output to `destUri`.
 *
 * @param sourceUri   Absolute file URI (e.g. "file:///data/.../plaintext.pdf")
 * @param destUri     Absolute file URI for the encrypted output
 * @param keyBase64   Base64-encoded 256-bit (32-byte) AES key
 * @returns           `{ iv }` — Base64-encoded IV; persist this for decryption
 *
 * @example
 * const key = generateAES256KeyBase64();           // see helper below
 * const { iv } = await encryptFile(srcUri, encUri, key);
 * // Store `key` and `iv` securely (e.g. encrypt with RSA and send in message)
 */
export async function encryptFile(
  sourceUri: string,
  destUri: string,
  keyBase64: string
): Promise<EncryptFileResult> {
  return assertNative().encryptFile(sourceUri, destUri, keyBase64);
}

/**
 * Decrypt a file at `sourceUri` → write plaintext to `destUri`.
 *
 * @param sourceUri   Absolute file URI of the encrypted file
 * @param destUri     Absolute file URI for the decrypted output
 * @param keyBase64   Base64-encoded 256-bit AES key (same key used during encryption)
 * @param ivBase64    Base64-encoded IV returned by `encryptFile`
 *
 * @example
 * await decryptFile(encUri, plainUri, key, iv);
 * // `plainUri` now contains the original file — open with IntentLauncher or share
 */
export async function decryptFile(
  sourceUri: string,
  destUri: string,
  keyBase64: string,
  ivBase64: string
): Promise<void> {
  return assertNative().decryptFile(sourceUri, destUri, keyBase64, ivBase64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 256-bit AES key and return it as Base64.
 * Safe to call on any platform (uses the JS crypto API).
 */
export function generateAES256KeyBase64(): string {
  const raw = new Uint8Array(32);
  // React Native exposes getRandomValues via react-native-get-random-values polyfill
  globalThis.crypto.getRandomValues(raw);
  return Buffer.from(raw).toString('base64');
}

/**
 * Check whether the native streaming module is available on this device.
 * Use this to fall back to the node-forge JS implementation when running in Expo Go.
 */
export function isNativeCryptoAvailable(): boolean {
  return Platform.OS === 'android' && Boolean(_native);
}
