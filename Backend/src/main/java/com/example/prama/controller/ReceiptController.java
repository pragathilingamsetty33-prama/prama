package com.example.prama.controller;

import com.example.prama.dto.ReceiptPacket;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.time.Instant;

@Controller
@RequiredArgsConstructor
public class ReceiptController {

    private final SimpMessagingTemplate messagingTemplate;
    private final org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    /**
     * Blind Relay for Message Receipts.
     * Routes the receipt directly to the original sender's private queue.
     */
    @MessageMapping("/chat.receipt")
    public void routeReceipt(@Payload ReceiptPacket receipt) {
        receipt.setTimestamp(Instant.now().toString());

        // 1. Persist the receipt for 1-on-1 chats ONLY. 
        // Group receipts are handled via High-Water Mark (last_read_at in group_members).
        if (receipt.getGroupId() == null && receipt.getMessageId() != null && "READ".equals(receipt.getStatus())) {
            jdbcTemplate.update(
                "UPDATE messages SET status = 'READ' WHERE id = ? AND recipient_id = ?",
                receipt.getMessageId(), receipt.getRecipientId()
            );
        }

        // 2. BROADCAST: If this is a group receipt, send to the entire group topic
        if (receipt.getGroupId() != null) {

            // Standardize payload for live sync
            receipt.setStatus("READ"); 
            messagingTemplate.convertAndSend(
                "/topic/group." + receipt.getGroupId(),
                receipt
            );

        } else {

            // 3. ZERO-KNOWLEDGE Relay: For 1-on-1, route to the original sender only
            messagingTemplate.convertAndSend(
                "/topic/messages." + receipt.getSenderId(),
                receipt
            );
        }
    }
}


