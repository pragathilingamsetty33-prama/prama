package com.example.prama.service;

import com.google.firebase.messaging.*;
import org.springframework.stereotype.Service;

@Service
public class NotificationService {

    public void sendPushNotification(String fcmToken, String title, String body) {
        if (fcmToken == null || fcmToken.isEmpty())
            return;

        Message message = Message.builder()
                .setToken(fcmToken)
                .setNotification(Notification.builder()
                        .setTitle(title)
                        .setBody(body)
                        .build())
                .setAndroidConfig(AndroidConfig.builder()
                        .setPriority(AndroidConfig.Priority.HIGH)
                        .build())
                .setWebpushConfig(WebpushConfig.builder()
                        .putHeader("Urgency", "high")
                        .build())
                .build();

        try {
            FirebaseMessaging.getInstance().sendAsync(message);
            System.out.println("🚀 Push notification sent to FCM in background");
        } catch (Exception e) {
            System.err.println("❌ Failed to send push notification: " + e.getMessage());
        }
    }
}
