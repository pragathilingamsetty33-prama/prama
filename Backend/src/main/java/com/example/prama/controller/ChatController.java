package com.example.prama.controller;

import com.example.prama.dto.ChatMessage;
import com.example.prama.dto.MessageDTO;
import com.example.prama.entity.Message;
import com.example.prama.entity.User;
import com.example.prama.repository.MessageRepository;
import com.example.prama.repository.UserRepository;
import com.example.prama.service.NotificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequiredArgsConstructor
public class ChatController {

    private final SimpMessagingTemplate messagingTemplate;
    private final UserRepository userRepository;
    private final MessageRepository messageRepository;
    private final com.example.prama.repository.GroupMessageRepository groupMessageRepository;
    private final com.example.prama.repository.FriendshipRepository friendshipRepository;
    private final NotificationService notificationService;

    // ============================================================================
    // HARDENED NON-NULL COMPLIANT REVOCATION ENDPOINT (UNIVERSAL STRING UUID MAPS)
    // ============================================================================
    @org.springframework.web.bind.annotation.DeleteMapping("/api/v1/messages/{messageId}/revoke")
    @org.springframework.transaction.annotation.Transactional
    public ResponseEntity<?> revokeMessage(@PathVariable String messageId, java.security.Principal principal) {
        String principalName = principal.getName();

        UUID msgUuid;
        try {
            msgUuid = UUID.fromString(messageId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(org.springframework.http.HttpStatus.BAD_REQUEST).body("Invalid identifier format.");
        }
        
        // 1. SCAN LAYER A: Group Message Repository Space
        if (groupMessageRepository != null) {
            java.util.Optional<com.example.prama.entity.GroupMessage> groupMsgOpt = groupMessageRepository.findById(msgUuid);
            if (groupMsgOpt.isPresent()) {
                com.example.prama.entity.GroupMessage gMsg = groupMsgOpt.get();
                
                User sender = userRepository.findById(gMsg.getSenderId()).orElse(null);
                if (sender == null || (!principalName.equals(sender.getEmail()) && 
                    !principalName.equals(sender.getId().toString()) && 
                    !principalName.equals(sender.getUsername()))) {
                    return ResponseEntity.status(org.springframework.http.HttpStatus.FORBIDDEN).body("Access claims rejected.");
                }
                
                // Fix: Overwrite content with safe empty text to satisfy NOT NULL constraints
                gMsg.setDeleted(true);
                gMsg.setEncryptedContent(""); 
                groupMessageRepository.save(gMsg);
                
                Map<String, Object> gPacket = new HashMap<>();
                gPacket.put("type", "MESSAGE_REVOKED");
                gPacket.put("messageId", messageId);
                gPacket.put("chatType", "GROUP");
                gPacket.put("groupId", gMsg.getGroupId().toString());
                
                messagingTemplate.convertAndSend("/topic/group." + gMsg.getGroupId(), gPacket);
                return ResponseEntity.ok().body(Map.of("success", true, "messageId", messageId));
            }
        }

        // 2. SCAN LAYER B: Private Message Repository Space
        java.util.Optional<Message> privateMsgOpt = messageRepository.findById(msgUuid);
        if (privateMsgOpt.isPresent()) {
            Message pMsg = privateMsgOpt.get();
            
            if (!principalName.equals(pMsg.getSender().getEmail()) && 
                !principalName.equals(pMsg.getSender().getId().toString()) && 
                !principalName.equals(pMsg.getSender().getUsername())) {
                return ResponseEntity.status(org.springframework.http.HttpStatus.FORBIDDEN).body("Access claims rejected.");
            }
            
            // Fix: Overwrite content with safe empty text to satisfy NOT NULL constraints
            pMsg.setDeleted(true);
            pMsg.setEncryptedContent(""); 
            messageRepository.save(pMsg);
            
            Map<String, Object> pPacket = new HashMap<>();
            pPacket.put("type", "MESSAGE_REVOKED");
            pPacket.put("messageId", messageId);
            pPacket.put("chatType", "PRIVATE");
            
            executePrivateShotgunBroadcast(pMsg, pPacket);
            return ResponseEntity.ok().body(Map.of("success", true, "messageId", messageId));
        }

        return ResponseEntity.status(org.springframework.http.HttpStatus.NOT_FOUND).body("Target unique entity could not be resolved.");
    }

    // ============================================================================
    // HARDENED NON-NULL COMPLIANT EDITING ENDPOINT (UNIVERSAL STRING UUID MAPS)
    // ============================================================================
    @org.springframework.web.bind.annotation.PutMapping("/api/v1/messages/{messageId}/edit")
    @org.springframework.transaction.annotation.Transactional
    public ResponseEntity<?> editMessage(@PathVariable String messageId, @org.springframework.web.bind.annotation.RequestBody Map<String, String> payload, java.security.Principal principal) {
        String principalName = principal.getName();

        UUID msgUuid;
        try {
            msgUuid = UUID.fromString(messageId);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(org.springframework.http.HttpStatus.BAD_REQUEST).body("Invalid identifier format.");
        }
        
        // 1. SCAN LAYER A: Group Message Space
        if (groupMessageRepository != null) {
            java.util.Optional<com.example.prama.entity.GroupMessage> groupMsgOpt = groupMessageRepository.findById(msgUuid);
            if (groupMsgOpt.isPresent()) {
                com.example.prama.entity.GroupMessage gMsg = groupMsgOpt.get();
                User sender = userRepository.findById(gMsg.getSenderId()).orElse(null);
                
                if (sender == null || (!principalName.equals(sender.getEmail()) && 
                    !principalName.equals(sender.getId().toString()) && 
                    !principalName.equals(sender.getUsername()))) {
                    return ResponseEntity.status(org.springframework.http.HttpStatus.FORBIDDEN).body("Modification claims rejected.");
                }
                
                gMsg.setEncryptedContent(payload.get("encryptedContent"));
                gMsg.setIv(payload.get("iv"));
                gMsg.setTag(payload.get("tag"));
                gMsg.setEdited(true);
                groupMessageRepository.save(gMsg);
                
                Map<String, Object> gPacket = new HashMap<>();
                gPacket.put("type", "MESSAGE_EDITED");
                gPacket.put("messageId", messageId);
                gPacket.put("encryptedContent", payload.get("encryptedContent"));
                gPacket.put("iv", payload.get("iv"));
                gPacket.put("tag", payload.get("tag"));
                gPacket.put("chatType", "GROUP");
                gPacket.put("groupId", gMsg.getGroupId().toString());
                
                messagingTemplate.convertAndSend("/topic/group." + gMsg.getGroupId(), gPacket);
                return ResponseEntity.ok().body(Map.of("success", true, "messageId", messageId));
            }
        }

        // 2. SCAN LAYER B: Private Message Space
        java.util.Optional<Message> privateMsgOpt = messageRepository.findById(msgUuid);
        if (privateMsgOpt.isPresent()) {
            Message pMsg = privateMsgOpt.get();
            if (!principalName.equals(pMsg.getSender().getEmail()) && 
                !principalName.equals(pMsg.getSender().getId().toString()) && 
                !principalName.equals(pMsg.getSender().getUsername())) {
                return ResponseEntity.status(org.springframework.http.HttpStatus.FORBIDDEN).body("Modification claims rejected.");
            }
            
            pMsg.setEncryptedContent(payload.get("encryptedContent"));
            pMsg.setIv(payload.get("iv"));
            pMsg.setTag(payload.get("tag"));
            pMsg.setEdited(true);
            messageRepository.save(pMsg);
            
            Map<String, Object> pPacket = new HashMap<>();
            pPacket.put("type", "MESSAGE_EDITED");
            pPacket.put("messageId", messageId);
            pPacket.put("encryptedContent", payload.get("encryptedContent"));
            pPacket.put("iv", payload.get("iv"));
            pPacket.put("tag", payload.get("tag"));
            pPacket.put("chatType", "PRIVATE");
            
            executePrivateShotgunBroadcast(pMsg, pPacket);
            return ResponseEntity.ok().body(Map.of("success", true, "messageId", messageId));
        }

        return ResponseEntity.status(org.springframework.http.HttpStatus.NOT_FOUND).body("Target unique entity could not be resolved.");
    }

    private void executePrivateShotgunBroadcast(Message pMsg, Map<String, Object> packet) {
        String sId = pMsg.getSender().getId().toString();
        String rId = pMsg.getRecipient().getId().toString();
        messagingTemplate.convertAndSendToUser(sId, "/queue/messages", packet);
        messagingTemplate.convertAndSendToUser(rId, "/queue/messages", packet);
        messagingTemplate.convertAndSendToUser(pMsg.getSender().getEmail(), "/queue/messages", packet);
        messagingTemplate.convertAndSendToUser(pMsg.getRecipient().getEmail(), "/queue/messages", packet);
    }

    @GetMapping("/api/v1/messages/{friendId}")
    @ResponseBody
    public List<MessageDTO> getConversation(
            @PathVariable UUID friendId,
            org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof User currentUser)) {
            throw new RuntimeException("Unauthorized");
        }

        var friend = userRepository.findById(friendId)
                .orElseThrow(() -> new RuntimeException("Friend not found"));

        return messageRepository.findConversation(currentUser, friend).stream()
                .map(m -> MessageDTO.builder()
                        .id(m.getId())
                        .senderId(m.getSender().getId())
                        .recipientId(m.getRecipient().getId())
                        .encryptedAesKey(m.getEncryptedAesKey())
                        .senderEncryptedAesKey(m.getSenderEncryptedAesKey())
                        .encryptedContent(m.getEncryptedContent())
                        .iv(m.getIv())
                        .tag(m.getTag())
                        .status(m.getStatus())
                        .timestamp(m.getTimestamp())
                        .build())
                .collect(Collectors.toList());
    }

    @MessageMapping("/chat.sendMessage")
    public void processMessage(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        UsernamePasswordAuthenticationToken auth = (UsernamePasswordAuthenticationToken) headerAccessor.getUser();
        if (auth == null || !(auth.getPrincipal() instanceof User)) {
            throw new RuntimeException("Unauthorized WebSocket Request");
        }

        User sender = (User) auth.getPrincipal();
        chatMessage.setSenderId(sender.getId());
        chatMessage.setStatus("SENT");
        chatMessage.setTimestamp(Instant.now().toString());

        userRepository.findById(chatMessage.getRecipientId()).ifPresent(recipient -> {
            // 🔥 GHOST PROTOCOL SILENT-DROP GATEWAY
            java.util.Optional<com.example.prama.entity.Friendship> activeLink = friendshipRepository.findByUserIds(sender.getId(), recipient.getId());
            if (activeLink.isEmpty()) {
                return; 
            }

            Message message = Message.builder()
                    .sender(sender)
                    .recipient(recipient)
                    .encryptedAesKey(chatMessage.getEncryptedAESKey())
                    .senderEncryptedAesKey(chatMessage.getSenderEncryptedAESKey())
                    .encryptedContent(chatMessage.getEncryptedContent())
                    .iv(chatMessage.getIv())
                    .tag(chatMessage.getTag())
                    .build();
            messageRepository.save(message);
            chatMessage.setId(message.getId());

            if (recipient.getFcmToken() != null) {
                notificationService.sendSecureNotification(
                    recipient.getFcmToken(),
                    sender.getUsername(),
                    chatMessage.getEncryptedContent(),
                    chatMessage.getIv(),
                    chatMessage.getTag(),
                    chatMessage.getEncryptedAESKey()
                );
            }
        });

        messagingTemplate.convertAndSendToUser(
                chatMessage.getRecipientId().toString(),
                "/queue/messages",
                chatMessage
        );

    }

    /**
     * Mark all messages from a friend as read.
     * High-Water Mark: Updates status to 'READ' and broadcasts receipt.
     */
    @PostMapping("/api/v1/messages/{friendId}/read")
    public ResponseEntity<?> markAsRead(@PathVariable UUID friendId, org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof User currentUser)) {
            return ResponseEntity.status(401).body("Unauthorized");
        }

        // 1. Update DB: Set all messages FROM the friend TO me as READ
        messageRepository.markAsRead(friendId, currentUser.getId());

        // 2. Broadcast RECEIPT_UPDATE to the friend
        Map<String, Object> receiptPayload = new HashMap<>();
        receiptPayload.put("type", "RECEIPT_UPDATE");
        receiptPayload.put("readerId", currentUser.getId());
        receiptPayload.put("lastReadAt", LocalDateTime.now().toString());

        try {
            // Route 1: Target via raw database Numeric ID string
            messagingTemplate.convertAndSendToUser(friendId.toString(), "/queue/messages", receiptPayload);

            // Fetch the friend account entity to extract Principal strings (Username/Email)
            User friend = userRepository.findById(friendId).orElse(null);
            if (friend != null) {
                String usernameTarget = friend.getUsername();
                String emailTarget = friend.getEmail();

                if (usernameTarget != null) {
                    messagingTemplate.convertAndSendToUser(usernameTarget, "/queue/messages", receiptPayload);
                }

                if (emailTarget != null) {
                    messagingTemplate.convertAndSendToUser(emailTarget, "/queue/messages", receiptPayload);
                }
            }
        } catch (Exception ex) {
            System.err.println("Broadcast mapping failed");
            ex.printStackTrace();
        }

        return ResponseEntity.ok().build();
    }
}
