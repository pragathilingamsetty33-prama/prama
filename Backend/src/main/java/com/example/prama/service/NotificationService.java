package com.example.prama.service;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.Notification;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class NotificationService {

    /**
     * Sends a "Ghost Notification" (Data-only FCM).
     * ZERO-KNOWLEDGE: The server only sends encrypted blobs.
     */
    public void sendSecureNotification(String fcmToken, String senderName, String encryptedPayload, String iv, String tag, String wrappedKey) {
        // We do NOT use the .setNotification() block.
        // This prevents the OS from showing a notification automatically.
        Message message = Message.builder()
                .setToken(fcmToken)
                .putAllData(Map.of(
                        "type", "SECURE_MESSAGE",
                        "senderName", senderName, // This can be a nickname or public ID
                        "encryptedPayload", encryptedPayload,
                        "iv", iv,
                        "tag", tag,
                        "wrappedKey", wrappedKey
                ))
                .build();

        try {
            FirebaseMessaging.getInstance().send(message);
        } catch (Exception e) {
            System.err.println("Failed to send FCM: " + e.getMessage());
        }
    }
}
