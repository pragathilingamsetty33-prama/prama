import { 
  generateAESKey, 
  encryptAESKeyWithRSA, 
  encryptMessageWithAES 
} from './crypto.native';
import { API_BASE_URL } from '../constants/Config';

/**
 * GroupMessageOrchestrator implements the N-Wrap (Sender Key Fan-out) architecture.
 * It ensures a message is encrypted once and the symmetric key is wrapped
 * individually for every group member.
 */

export interface GroupMessagePacket {
  groupId: string;
  senderId: string;
  encryptedMessage: string; // AES-256-GCM encrypted payload
  iv: string;
  tag: string;
  // Map of recipientUserId -> RSA-wrapped AES Key
  wrappedKeys: { [userId: string]: string };
}

export class GroupMessageOrchestrator {
  /**
   * Performs the N-Wrap encryption flow for a group message.
   */
  static async encryptForGroup(
    groupId: string,
    senderId: string,
    payload: string,
    apiFetch: (url: string) => Promise<Response>
  ): Promise<GroupMessagePacket> {
    // 1. Fetch group roster and public keys in one batch
    const response = await apiFetch(`${API_BASE_URL}/api/v1/groups/${groupId}/roster-keys`);
    if (!response.ok) throw new Error('Failed to fetch group keys');
    const roster: Array<{ userId: string; publicKey: string }> = await response.json();

    // 2. Generate a single ephemeral AES key for this group message
    const aesKey = generateAESKey();

    // 3. Encrypt the payload once with AES-256-GCM
    const encryptedData = encryptMessageWithAES(payload, aesKey);

    // 4. "N-Wrap": Loop through the roster and wrap the AES key for each member
    const wrappedKeys: { [userId: string]: string } = {};
    for (const member of roster) {
      // Skip wrapping for the sender (or use the sender's PK for history)
      wrappedKeys[member.userId] = encryptAESKeyWithRSA(aesKey, member.publicKey);
    }

    return {
      groupId,
      senderId,
      encryptedMessage: encryptedData.ciphertext,
      iv: encryptedData.iv,
      tag: encryptedData.tag,
      wrappedKeys,
    };
  }
}
