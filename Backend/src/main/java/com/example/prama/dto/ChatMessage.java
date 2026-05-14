package com.example.prama.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class ChatMessage {
    private UUID id;
    private UUID senderId;
    private UUID recipientId;
    
    // The temporary AES key, encrypted with the recipient's RSA Public Key
    private String encryptedAESKey;
    
    // The same AES key, encrypted with the sender's own RSA Public Key (for sender history)
    private String senderEncryptedAESKey;
    
    // The actual chat message, encrypted with the temporary AES Key
    private String encryptedMessage;
    
    private String timestamp;
}
