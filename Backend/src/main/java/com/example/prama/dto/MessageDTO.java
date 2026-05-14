package com.example.prama.dto;

import lombok.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MessageDTO {
    private UUID id;
    private UUID senderId;
    private UUID recipientId;
    private String encryptedAesKey;
    private String senderEncryptedAesKey;
    private String encryptedMessage;
    private LocalDateTime timestamp;
}
