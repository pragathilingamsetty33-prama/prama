import * as SecureStore from 'expo-secure-store';
import { MessageOrchestrator } from './MessageOrchestrator';
import { Buffer } from 'buffer';

/**
 * DecryptionWorker handles background decryption of Ghost Notifications.
 * It attempts to retrieve keys and decrypt the payload without UI interaction.
 */
export class DecryptionWorker {
  static async decryptNotification(data: any): Promise<{ title: string; body: string }> {
    try {
      // 1. Try to retrieve the MasterKey from SecureStore
      // This may fail if the device is in 'Cold Boot' (locked after reboot)
      const masterKeyBase64 = await SecureStore.getItemAsync('prama_master_key');
      
      if (!masterKeyBase64) {
        throw new Error('Vault Locked');
      }

      const masterKey = new Uint8Array(Buffer.from(masterKeyBase64, 'base64'));

      // 2. Perform the Decryption Handshake
      // The data payload contains the wrappedKey, iv, tag, and encryptedPayload
      const decryptedContent = await MessageOrchestrator.decryptIncoming(
        {
          encryptedMessage: data.encryptedPayload,
          iv: data.iv,
          tag: data.tag,
          encryptedAESKey: data.wrappedKey,
        },
        masterKey
      );

      let messageText = decryptedContent;
      try {
        const parsed = JSON.parse(decryptedContent);
        messageText = parsed.text || "New Attachment";
      } catch (e) {
        // Plain text fallback
      }

      return {
        title: data.senderName || 'Prama Secure',
        body: messageText,
      };

    } catch (error) {
      // Fail-safe: Generic notification
      return {
        title: 'Prama Secure',
        body: 'You have a new secure message.',
      };
    }
  }
}
