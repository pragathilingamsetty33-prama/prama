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

        messagingTemplate.convertAndSend(
                "/topic/messages." + chatMessage.getRecipientId().toString(),
                chatMessage
        );

    }
}
