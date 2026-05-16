/**
 * ReceiptManager handles the generation of delivery and read acknowledgments.
 */

export interface ReceiptPacket {
  messageId: string;
  senderId: string;
  recipientId: string;
  status: 'DELIVERED' | 'READ';
  timestamp?: string;
}

export class ReceiptManager {
  /**
   * Sends a receipt to the server.
   */
  static sendReceipt(
    stompClient: any,
    messageId: string,
    senderId: string,
    currentUserId: string,
    status: 'DELIVERED' | 'READ'
  ) {
    if (!stompClient?.connected) return;

    const packet: ReceiptPacket = {
      messageId,
      senderId,
      recipientId: currentUserId,
      status,
    };

    stompClient.send('/app/chat.receipt', {}, JSON.stringify(packet));
  }

  /**
   * Automatically acknowledes delivery for a received packet.
   */
  static acknowledgeDelivery(stompClient: any, payload: any, currentUserId: string) {
    if (payload.id && payload.senderId !== currentUserId) {
      this.sendReceipt(stompClient, payload.id, payload.senderId, currentUserId, 'DELIVERED');
    }
  }

  /**
   * Acknowledges that a message has been read (decrypted and displayed).
   */
  static acknowledgeRead(stompClient: any, messageId: string, senderId: string, currentUserId: string) {
    this.sendReceipt(stompClient, messageId, senderId, currentUserId, 'READ');
  }
}
