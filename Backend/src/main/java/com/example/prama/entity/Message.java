package com.example.prama.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
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

    @ManyToOne
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    @ManyToOne
    @JoinColumn(name = "recipient_id", nullable = false)
    private User recipient;

    @Column(columnDefinition = "TEXT", nullable = false)
    private String encryptedContent;

    @Column(columnDefinition = "TEXT", nullable = false)
    private String encryptedAesKey;

    @Column(columnDefinition = "TEXT")
    private String senderEncryptedAesKey;

    @Column(nullable = false)
    private String iv;

    @Column(nullable = false)
    private String tag;

    @Column(nullable = false)
    private Instant timestamp;

    @Column(nullable = false)
    @Builder.Default
    private String status = "SENT"; // SENT, DELIVERED, READ

    @Column(name = "is_deleted")
    private boolean isDeleted = false;

    @Column(name = "is_edited")
    private boolean isEdited = false;

    @PrePersist
    protected void onCreate() {
        timestamp = Instant.now();
    }
}
