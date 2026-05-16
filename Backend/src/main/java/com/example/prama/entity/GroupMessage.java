package com.example.prama.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "group_messages")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GroupMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(name = "group_id", nullable = false)
    private UUID groupId;

    @Column(name = "sender_id", nullable = false)
    private UUID senderId;

    @Column(name = "encrypted_message", columnDefinition = "TEXT", nullable = false)
    private String encryptedContent;

    @Column(nullable = false)
    private String iv;

    @Column(nullable = false)
    private String tag;

    @Column(nullable = false)
    private Instant timestamp;

    @ElementCollection
    @CollectionTable(name = "group_message_keys", joinColumns = @JoinColumn(name = "message_id"))
    @MapKeyColumn(name = "user_id")
    @Column(name = "encrypted_key", length = 1000)
    @Builder.Default
    private Map<String, String> wrappedKeys = new HashMap<>();

    @Column(name = "is_deleted")
    private boolean isDeleted = false;

    @Column(name = "is_edited")
    private boolean isEdited = false;

    @PrePersist
    protected void onCreate() {
        if (timestamp == null) {
            timestamp = Instant.now();
        }
    }
}
