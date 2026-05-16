package com.example.prama.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FriendDTO {
    private UUID id; // Friendship ID (or request ID)
    private UUID userId; // The friend's User ID
    private String username;
    private String email;
    private String alias;
    private String avatar;
}
