package com.example.prama.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "user_public_keys")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserPublicKey {

    @Id
    private java.util.UUID userId; // One-to-one with User ID

    @Column(columnDefinition = "TEXT", nullable = false)
    private String publicKey;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @OneToOne
    @MapsId
    @JoinColumn(name = "user_id")
    private User user;

    @PrePersist
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
