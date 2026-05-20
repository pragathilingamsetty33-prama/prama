import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import forge from 'node-forge';
import { encryptDataWithPassword, decryptDataWithPassword } from './crypto.native';

/**
 * BiometricManager handles the secure persistence of the MasterKey
 * using hardware-backed wrapping keys.
 */

const KEYS = {
  BIOMETRIC_WRAP_KEY: 'prama_bio_wrap_key',
  WRAPPED_MASTER_KEY: 'prama_wrapped_master_key',
};

export class BiometricManager {
  /**
   * Check if biometrics are available and enrolled on the device.
   */
  static async isAvailable(): Promise<boolean> {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  }

  /**
   * Enable biometric unlock by wrapping the MasterKey with a hardware-backed key.
   */
  static async enableBiometrics(masterKey: Uint8Array): Promise<void> {
    try {
      // 1. Generate a random Biometric-Wrap-Key
      const wrapKey = forge.random.getBytesSync(32);
      const wrapKeyBase64 = Buffer.from(wrapKey, 'binary').toString('base64');

      // 2. Store the Wrap-Key in SecureStore with hardware authentication requirement
      await SecureStore.setItemAsync(KEYS.BIOMETRIC_WRAP_KEY, wrapKeyBase64, {
        requireAuthentication: true,
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      });

      // 3. Encrypt the MasterKey using the Wrap-Key (AES-GCM wrapping)
      const wrappedBundle = encryptDataWithPassword(
        Buffer.from(masterKey).toString('base64'),
        new Uint8Array(Buffer.from(wrapKey, 'binary'))
      );

      // 4. Store the wrapped MasterKey in standard storage
      // Note: We use standard SecureStore without requireAuthentication for the bundle itself
      // because the WRAP_KEY is the one that is hardware-protected.
      await SecureStore.setItemAsync(KEYS.WRAPPED_MASTER_KEY, JSON.stringify(wrappedBundle));
    } catch (error) {
      console.error('Failed to enable biometrics:', error);
      throw error;
    }
  }

  /**
   * Attempt to unlock and retrieve the MasterKey using biometrics.
   */
  static async unlock(): Promise<Uint8Array | null> {
    try {
      // 1. Check if we have a wrapped key
      const wrappedBundleStr = await SecureStore.getItemAsync(KEYS.WRAPPED_MASTER_KEY);
      if (!wrappedBundleStr) return null;

      // 2. Authenticate the user
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Prama Secure Session',
        fallbackLabel: 'Use Password',
        disableDeviceFallback: false,
      });

      if (!auth.success) return null;

      // 3. Retrieve the hardware-backed Wrap-Key
      // This call will only succeed if the biometric check passed
      const wrapKeyBase64 = await SecureStore.getItemAsync(KEYS.BIOMETRIC_WRAP_KEY, {
        requireAuthentication: true,
      });

      if (!wrapKeyBase64) {
        throw new Error('Biometric Wrap Key missing or invalidated');
      }

      // 4. Decrypt the MasterKey
      const wrappedBundle = JSON.parse(wrappedBundleStr);
      const masterKeyBase64 = decryptDataWithPassword(
        wrappedBundle,
        new Uint8Array(Buffer.from(wrapKeyBase64, 'base64'))
      );

      return new Uint8Array(Buffer.from(masterKeyBase64, 'base64'));

    } catch (error) {
      await this.disableBiometrics();
      return null;
    }
  }

  /**
   * Disable biometrics and clear all wrapped keys (Fail-Safe).
   */
  static async disableBiometrics(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.BIOMETRIC_WRAP_KEY);
    await SecureStore.deleteItemAsync(KEYS.WRAPPED_MASTER_KEY);
  }

  /**
   * Check if a biometric session is currently setup.
   */
  static async isSetup(): Promise<boolean> {
    const key = await SecureStore.getItemAsync(KEYS.WRAPPED_MASTER_KEY);
    return !!key;
  }
}
