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
import org.springframework.web.bind.annotation.ResponseBody;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Controller
@RequiredArgsConstructor
public class ChatController {

    private final SimpMessagingTemplate messagingTemplate;
    private final UserRepository userRepository;
    private final MessageRepository messageRepository;
    private final NotificationService notificationService;

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
                        .encryptedMessage(m.getEncryptedContent())
                        .timestamp(m.getTimestamp())
                        .build())
                .collect(Collectors.toList());
    }

    @MessageMapping("/chat.sendMessage")
    public void processMessage(@Payload ChatMessage chatMessage, SimpMessageHeaderAccessor headerAccessor) {
        // Extract the authenticated sender from the WebSocket session
        UsernamePasswordAuthenticationToken auth = (UsernamePasswordAuthenticationToken) headerAccessor.getUser();
        if (auth == null || !(auth.getPrincipal() instanceof User)) {
            throw new RuntimeException("Unauthorized WebSocket Request");
        }

        User sender = (User) auth.getPrincipal();

        // Enforce that the sender ID matches the authenticated user
        chatMessage.setSenderId(sender.getId());
        chatMessage.setTimestamp(Instant.now().toString());

        // Persist message and send push notification to recipient
        userRepository.findById(chatMessage.getRecipientId()).ifPresent(recipient -> {
            // Save to DB
            Message message = Message.builder()
                    .sender(sender)
                    .recipient(recipient)
                    .encryptedAesKey(chatMessage.getEncryptedAESKey())
                    .senderEncryptedAesKey(chatMessage.getSenderEncryptedAESKey())
                    .encryptedContent(chatMessage.getEncryptedMessage())
                    .build();
            messageRepository.save(message);
            chatMessage.setId(message.getId());

            // Push notification
            if (recipient.getFcmToken() != null) {
                notificationService.sendPushNotification(
                    recipient.getFcmToken(),
                    "New Encrypted Message",
                    "You have a new secure message from " + sender.getUsername()
                );
            }
        });

        // Because messages are end-to-end encrypted with the recipient's public key, 
        // we can safely route them using a specific UUID topic. Even if intercepted, 
        // they cannot be decrypted without the recipient's private key.
        messagingTemplate.convertAndSend(
                "/topic/messages/" + chatMessage.getRecipientId().toString(),
                chatMessage
        );
    }
}
