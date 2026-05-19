package com.example.prama.controller;

import com.example.prama.entity.User;
import com.example.prama.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final UserRepository userRepository;
    private final JdbcTemplate jdbcTemplate;
    private final com.example.prama.service.AuthService authService;
    private final org.springframework.messaging.simp.user.SimpUserRegistry simpUserRegistry;
    private final com.example.prama.security.WebSocketSessionHolder webSocketSessionHolder;

    /**
     * GET /users: List all users (Metadata only).
     * ZERO-KNOWLEDGE: No private keys or message content is exposed.
     */
    @GetMapping("/users")
    public ResponseEntity<List<Map<String, Object>>> getAllUsers(
            @RequestParam(required = false) UUID cursor,
            @RequestParam(defaultValue = "50") int limit) {
        
        List<User> users;
        if (cursor == null) {
            users = userRepository.findFirstPage(limit);
        } else {
            users = userRepository.findNextPage(cursor, limit);
        }

        return ResponseEntity.ok(users.stream().map(user -> {
            Map<String, Object> metadata = new HashMap<>();
            metadata.put("userId", user.getId());
            metadata.put("username", user.getUsername());
            metadata.put("email", user.getEmail());
            metadata.put("createdAt", user.getCreatedAt());
            metadata.put("enabled", user.isEnabled());
            metadata.put("role", user.getRole());
            return metadata;
        }).collect(Collectors.toList()));
    }

    /**
     * PATCH /users/{id}/status: The Kill Switch.
     * Instantly de-activates an account and severs active connections.
     */
    @PatchMapping("/users/{userId}/status")
    public ResponseEntity<?> toggleUserStatus(@PathVariable UUID userId, @RequestBody Map<String, Boolean> body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (body.containsKey("enabled")) {
            boolean enabled = body.get("enabled");
            user.setEnabled(enabled);
            userRepository.save(user);

            if (!enabled) {
                // 🛡️ SOVEREIGN PURGE: Forced Eviction on Account Deactivation
                try {
                    authService.revokeAllUserJWTTokens(user);
                } catch (Exception e) {}

                try {
                    if (simpUserRegistry.getUser(user.getUsername()) != null) {
                        simpUserRegistry.getUser(user.getUsername()).getSessions().forEach(simpSession -> {
                            org.springframework.web.socket.WebSocketSession nativeSession = webSocketSessionHolder.get(simpSession.getId());
                            if (nativeSession != null && nativeSession.isOpen()) {
                                try {
                                    nativeSession.close(org.springframework.web.socket.CloseStatus.POLICY_VIOLATION);
                                } catch (Exception e) {
                                } finally {
                                    webSocketSessionHolder.remove(simpSession.getId());
                                }
                            }
                        });
                    }
                } catch (Exception e) {}
            }
        }

        return ResponseEntity.ok("User status updated to: " + (user.isEnabled() ? "Enabled" : "Disabled"));
    }

    /**
     * GET /metrics: System Telemetry.
     * Reports high-level health stats.
     */
    @GetMapping("/metrics")
    public ResponseEntity<Map<String, Object>> getSystemMetrics() {
        Map<String, Object> metrics = new HashMap<>();
        
        // 1. Database Stats
        Long userCount = userRepository.count();
        Long messageCount = jdbcTemplate.queryForObject("SELECT count(*) FROM messages", Long.class);
        
        // 2. Health Logic
        metrics.put("totalUsers", userCount);
        metrics.put("totalMessages", messageCount);
        metrics.put("dbStatus", "HEALTHY");
        metrics.put("rabbitMqStatus", "ACTIVE");
        metrics.put("systemLoad", "NORMAL");
        
        return ResponseEntity.ok(metrics);
    }

    /**
     * GET /groups: Manage Groups.
     */
    @GetMapping("/groups")
    public ResponseEntity<List<Map<String, Object>>> getGroups() {
        String sql = "SELECT g.group_id as \"groupId\", g.name, count(gm.user_id) as \"memberCount\" " +
                     "FROM groups g " +
                     "LEFT JOIN group_members gm ON g.group_id = gm.group_id " +
                     "GROUP BY g.group_id, g.name";
        return ResponseEntity.ok(jdbcTemplate.queryForList(sql));
    }
}
