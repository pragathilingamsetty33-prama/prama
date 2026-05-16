import { 
  generateAESKey, 
  encryptAESKeyWithRSA, 
  decryptAESKeyWithRSA, 
  encryptMessageWithAES, 
  decryptMessageWithAES 
} from './crypto.native';
import { IdentityManager } from './IdentityManager';
import { API_BASE_URL } from '../constants/Config';

/**
 * MessageOrchestrator handles the high-level logic for E2EE message exchange.
 * It combines RSA-OAEP for key wrapping and AES-256-GCM for content encryption.
 */

export interface SecureMessagePacket {
  id?: string;
  senderId: string;
  recipientId: string;
  encryptedAESKey: string;      // RSA-encrypted with recipient's public key
  senderEncryptedAESKey?: string; // RSA-encrypted with sender's public key (for multi-device/history)
  encryptedMessage: string;     // The actual message or file metadata
  iv: string;                   // AES IV
  tag: string;                  // AES GCM Tag
  timestamp?: string;
}

export class MessageOrchestrator {
  /**
   * Prepares a secure packet for a recipient.
   */
  static async encryptForRecipient(
    recipientId: string,
    senderId: string,
    payload: string,
    masterKey: Uint8Array
  ): Promise<SecureMessagePacket> {
    // 1. Fetch recipient's Public Key from backend
    const response = await fetch(`${API_BASE_URL}/api/v1/users/keys/${recipientId}`);
    if (!response.ok) throw new Error('Could not fetch recipient public key');
    const recipientPublicKey = await response.text();

    // 2. Generate ephemeral AES key
    const aesKey = generateAESKey();

    // 3. Encrypt payload with AES-256-GCM
    const encryptedData = encryptMessageWithAES(payload, aesKey);

    // 4. Wrap AES key with recipient's RSA Public Key
    const encryptedAESKey = encryptAESKeyWithRSA(aesKey, recipientPublicKey);

    // 5. (Optional) Wrap AES key with sender's own RSA Public Key for sync/history
    const senderPublicKey = await IdentityManager.getPublicKey();
    let senderEncryptedAESKey = undefined;
    if (senderPublicKey) {
      senderEncryptedAESKey = encryptAESKeyWithRSA(aesKey, senderPublicKey);
    }

    return {
      senderId,
      recipientId,
      encryptedAESKey,
      senderEncryptedAESKey,
      encryptedMessage: encryptedData.ciphertext,
      iv: encryptedData.iv,
      tag: encryptedData.tag,
    };
  }

  /**
   * Decrypts an incoming secure packet.
   */
  static async decryptIncoming(
    packet: SecureMessagePacket,
    masterKey: Uint8Array
  ): Promise<string> {
    // 1. Retrieve and unwrap local RSA Private Key
    const privateKeyPem = await IdentityManager.getPrivateKey(masterKey);

    // 2. Decrypt the ephemeral AES key using RSA Private Key
    const aesKey = decryptAESKeyWithRSA(packet.encryptedAESKey, privateKeyPem);

    // 3. Decrypt the message payload using AES-256-GCM
    const decryptedPayload = decryptMessageWithAES({
      ciphertext: packet.encryptedMessage,
      iv: packet.iv,
      tag: packet.tag
    }, aesKey);

    return decryptedPayload;
  }
}
