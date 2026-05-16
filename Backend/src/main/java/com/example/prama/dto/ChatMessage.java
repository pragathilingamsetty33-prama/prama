package com.example.prama.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
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
    private UUID groupId;
    
    // The ephemeral AES key, encrypted with the recipient's RSA Public Key
    private String encryptedAESKey;
    
    // The same AES key, encrypted with the sender's own RSA Public Key (for sender history)
    private String senderEncryptedAESKey;
    
    // The actual content (message text or file metadata), encrypted with the AES key
    @JsonProperty("encryptedContent")
    private String encryptedContent;
    
    // AES-GCM parameters
    private String iv;
    private String tag;
    
    private String status;
    private String timestamp;
    @Builder.Default
    private String type = "CHAT_MESSAGE";
}
