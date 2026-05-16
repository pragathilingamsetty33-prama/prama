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
public class ReceiptPacket {
    private UUID messageId;
    private UUID senderId;      // The original sender of the message (who receives this receipt)
    private UUID recipientId;   // The user who is sending this receipt
    private UUID groupId;       // Null for private, non-null for group
    private String status;      // DELIVERED or READ
    private String timestamp;
    @Builder.Default
    private String type = "RECEIPT_UPDATE";
}
