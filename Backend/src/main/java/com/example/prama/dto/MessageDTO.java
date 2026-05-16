package com.example.prama.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class MessageDTO {
    private UUID id;
    private UUID senderId;
    private UUID recipientId;
    private String encryptedContent;
    private String encryptedAesKey;
    private String senderEncryptedAesKey;
    private String iv;
    private String tag;
    private String status;
    private Instant timestamp;
}
