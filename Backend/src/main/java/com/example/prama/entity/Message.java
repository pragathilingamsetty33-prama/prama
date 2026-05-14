package com.example.prama.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "messages")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Message {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recipient_id", nullable = false)
    private User recipient;

    @Column(name = "encrypted_aes_key", nullable = false, columnDefinition = "TEXT")
    private String encryptedAesKey;

    @Column(name = "sender_encrypted_aes_key", columnDefinition = "TEXT")
    private String senderEncryptedAesKey;

    @Column(name = "encrypted_content", nullable = false, columnDefinition = "TEXT")
    private String encryptedContent;

    @Builder.Default
    private LocalDateTime timestamp = LocalDateTime.now();
}
