package com.example.prama.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.UUID;

@Entity
@Table(name = "group_session_envelopes", indexes = {
    @Index(name = "idx_recipient_lookup", columnList = "group_id, recipient_id, is_active"),
    @Index(name = "idx_sender_invalidation", columnList = "group_id, sender_id, is_active")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GroupSessionEnvelope {

    @Id
    @Column(name = "id", length = 36)
    private String id; // Pre-allocated UUID or string to unlock true JDBC batch inserts

    @Column(name = "group_id", nullable = false, length = 36)
    private String groupId;

    @Column(name = "sender_id", nullable = false, length = 36)
    private String senderId;

    @Column(name = "sender_session_id", nullable = false, length = 36)
    private String senderSessionId;

    @Column(name = "recipient_id", nullable = false, length = 36)
    private String recipientId;

    @Column(name = "identity_key_version", nullable = false)
    private Integer identityKeyVersion;

    @Column(name = "encrypted_payload", nullable = false, columnDefinition = "BYTEA")
    private byte[] encryptedPayload; // Zero-copy binary column

    @Column(name = "is_active", nullable = false)
    private Boolean isActive = true;

    @PrePersist
    public void ensureId() {
        if (this.id == null) {
            this.id = UUID.randomUUID().toString();
        }
    }
}
