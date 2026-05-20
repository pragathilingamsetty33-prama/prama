import * as SecureStore from 'expo-secure-store';
import { generateRSAKeyPair, encryptDataWithPassword, decryptDataWithPassword } from './crypto.native';

/**
 * IdentityManager handles the lifecycle of the user's RSA Identity Keys.
 * It ensures the Private Key is always wrapped with the MasterKey before storage.
 */

// SECURE KEY NAMESPACES: Must be 100% identical to string keys used in AuthContext.tsx
const SECURE_STORE_KEYS = {
  WRAPPED_PRIVATE_KEY: 'prama_wrapped_private_key',
  PUBLIC_KEY: 'prama_public_key',
};

export class IdentityManager {
  /**
   * Generates a new RSA 2048-bit key pair and stores the wrapped private key.
   * @param masterKey The Argon2id derived MasterKey (Uint8Array)
   */
  static async generateAndStoreIdentity(masterKey: Uint8Array): Promise<string> {
    // 1. Generate RSA 2048-bit key pair
    const { publicKey, privateKey } = await generateRSAKeyPair();

    // 2. Wrap (Encrypt) the Private Key using the MasterKey (AES-GCM)
    const wrappedBundle = encryptDataWithPassword(privateKey, masterKey);

    // 3. Store the wrapped private key bundle in SecureStore
    await SecureStore.setItemAsync(
      SECURE_STORE_KEYS.WRAPPED_PRIVATE_KEY,
      JSON.stringify(wrappedBundle)
    );

    // 4. Store the public key in SecureStore for easy access
    await SecureStore.setItemAsync(SECURE_STORE_KEYS.PUBLIC_KEY, publicKey);

    return publicKey;
  }

  /**
   * Unwraps and retrieves the RSA Private Key.
   * @param masterKey The Argon2id derived MasterKey (Uint8Array)
   */
  static async getPrivateKey(masterKey: Uint8Array): Promise<string> {
    const wrappedStr = await SecureStore.getItemAsync(SECURE_STORE_KEYS.WRAPPED_PRIVATE_KEY);
    if (!wrappedStr) throw new Error('No identity key found on this device');

    const wrappedBundle = JSON.parse(wrappedStr);
    
    // Decrypt the private key using the MasterKey
    return decryptDataWithPassword(wrappedBundle, masterKey);
  }

  /**
   * Retrieves the RSA Public Key from local storage.
   */
  static async getPublicKey(): Promise<string | null> {
    return await SecureStore.getItemAsync(SECURE_STORE_KEYS.PUBLIC_KEY);
  }

  /**
   * Clears the identity from the device (e.g. on logout or account deletion).
   */
  static async clearIdentity(): Promise<void> {
    await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.WRAPPED_PRIVATE_KEY);
    await SecureStore.deleteItemAsync(SECURE_STORE_KEYS.PUBLIC_KEY);
  }
}
