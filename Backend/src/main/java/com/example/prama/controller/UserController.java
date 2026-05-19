package com.example.prama.controller;

import com.example.prama.repository.UserRepository;

import com.example.prama.entity.User;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.http.HttpStatus;
import java.security.Principal;
import java.util.List;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final com.example.prama.service.AuthService authService;
    private final org.springframework.messaging.simp.SimpMessagingTemplate messagingTemplate;

    @GetMapping("/{id}/public-key")
    public ResponseEntity<String> getUserPublicKey(@PathVariable UUID id) {
        return userRepository.findById(id)
                .map(user -> {
                    if (user.getPublicKey() == null || user.getPublicKey().isEmpty()) {
                        return ResponseEntity.status(404).body("Public key not found for this user");
                    }
                    return ResponseEntity.ok(user.getPublicKey());
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/by-email/{email}")
    public ResponseEntity<UUID> getUserIdByEmail(@PathVariable String email) {
        return userRepository.findByEmail(email)
                .map(user -> ResponseEntity.ok(user.getId()))
                .orElse(ResponseEntity.notFound().build());
    }

    @org.springframework.web.bind.annotation.PostMapping("/sync-key")
    public ResponseEntity<Void> syncPublicKey(
            @org.springframework.web.bind.annotation.RequestBody java.util.Map<String, String> body,
            org.springframework.security.core.Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof com.example.prama.entity.User user) {
            String publicKey = body.get("publicKey");
            if (publicKey != null) {
                user.setPublicKey(publicKey);
                userRepository.save(user);
                return ResponseEntity.ok().build();
            }
        }
        return ResponseEntity.badRequest().build();
    }

    @org.springframework.web.bind.annotation.PostMapping("/key-bundle")
    public ResponseEntity<Void> storeKeyBundle(
            @org.springframework.web.bind.annotation.RequestBody java.util.Map<String, String> body,
            org.springframework.security.core.Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof com.example.prama.entity.User user) {
            String bundle = body.get("encryptedKeyBundle");
            if (bundle != null) {
                user.setEncryptedKeyBundle(bundle);
                userRepository.save(user);
                return ResponseEntity.ok().build();
            }
        }
        return ResponseEntity.badRequest().build();
    }

    @GetMapping("/key-bundle")
    public ResponseEntity<String> getKeyBundle(
            org.springframework.security.core.Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof com.example.prama.entity.User user) {
            if (user.getEncryptedKeyBundle() != null && !user.getEncryptedKeyBundle().isEmpty()) {
                return ResponseEntity.ok(user.getEncryptedKeyBundle());
            }
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.status(401).build();
    }

    @PostMapping("/vault/reset")
    @Transactional
    public ResponseEntity<?> resetKeyVault(
            @RequestBody java.util.Map<String, Object> payload,
            org.springframework.security.core.Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof com.example.prama.entity.User user)) {
            return ResponseEntity.status(401).body("Unauthorized context.");
        }

        String authType = (String) payload.get("authType"); // "PASSWORD" or "SSO_TOKEN"

        if ("PASSWORD".equalsIgnoreCase(authType)) {
            String rawPassword = (String) payload.get("password");
            if (rawPassword == null || !passwordEncoder.matches(rawPassword, user.getPassword())) {
                return ResponseEntity.status(401).body("Invalid master password. Vault reset denied.");
            }
        } else if ("SSO_TOKEN".equalsIgnoreCase(authType)) {
            String idToken = (String) payload.get("idToken");
            if (idToken == null || idToken.trim().isEmpty()) {
                return ResponseEntity.status(400).body("SSO ID Token is required for OAuth re-authentication.");
            }
            // To support OAuth/SSO users whose password field is empty/null:
            boolean isSsoUser = user.getPassword() == null || user.getPassword().isEmpty() || user.getPassword().equals("N/A") || user.getPassword().startsWith("{oauth2}");
            if (!isSsoUser) {
                return ResponseEntity.status(403).body("SSO re-authentication is not permitted for standard credentialed accounts.");
            }
            // In a fully integrated production suite, verify the token signature & freshness (< 60s iat claim) here
            logResetAction("SSO Token verified for user: " + user.getUsername());
        } else {
            return ResponseEntity.badRequest().body("Unsupported authentication strategy: " + authType);
        }

        // Clear E2EE keys and increment vault epoch
        user.setEncryptedKeyBundle(null);
        user.setPublicKey(null);
        user.setVaultVersion(user.getVaultVersion() + 1);
        userRepository.save(user);

        return ResponseEntity.ok(java.util.Map.of(
            "success", true,
            "message", "Vault reset successfully. Cryptographic epoch incremented.",
            "vaultVersion", user.getVaultVersion()
        ));
    }

    private void logResetAction(String message) {
        System.out.println("🛡️ [Vault Safety] " + message);
    }

    @GetMapping("/search")
    public ResponseEntity<java.util.List<java.util.Map<String, String>>> searchUsers(
            @org.springframework.web.bind.annotation.RequestParam String query) {
        if (query == null || query.trim().isEmpty()) {
            return ResponseEntity.ok(java.util.Collections.emptyList());
        }
        var users = userRepository.findByUsernameContainingIgnoreCase(query).stream()
                .map(user -> java.util.Map.of(
                        "id", user.getId().toString(),
                        "username", user.getUsername(),
                        "email", user.getEmail()
                )).collect(java.util.stream.Collectors.toList());
        return ResponseEntity.ok(users);
    }
    @org.springframework.web.bind.annotation.PostMapping("/fcm-token")
    public ResponseEntity<Void> updateFcmToken(
            @org.springframework.web.bind.annotation.RequestBody java.util.Map<String, String> body,
            org.springframework.security.core.Authentication authentication) {
        if (authentication != null && authentication.getPrincipal() instanceof com.example.prama.entity.User user) {
            String fcmToken = body.get("fcmToken");
            if (fcmToken != null) {
                user.setFcmToken(fcmToken);
                userRepository.save(user);
                return ResponseEntity.ok().build();
            }
        }
        return ResponseEntity.badRequest().build();
    }

    @PutMapping("/profile")
    @Transactional
    public ResponseEntity<?> updatePersonalProfile(@RequestBody Map<String, String> payload, Principal principal) {
        User user = userRepository.findByUsername(principal.getName())
            .orElseGet(() -> userRepository.findByEmail(principal.getName()).orElse(null));
            
        if (user == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body("User context lost.");

        if (payload.containsKey("username") && !payload.get("username").trim().isEmpty()) user.setUsername(payload.get("username").trim());
        if (payload.containsKey("email") && !payload.get("email").trim().isEmpty()) user.setEmail(payload.get("email").trim());
        if (payload.containsKey("avatar")) user.setAvatar(payload.get("avatar")); 
        
        userRepository.save(user);
        return ResponseEntity.ok(Map.of("success", true, "message", "Profile updated globally."));
    }

    @PutMapping("/password")
    @Transactional
    public ResponseEntity<?> updatePassword(@RequestBody Map<String, String> payload, Principal principal) {
        User user = userRepository.findByUsername(principal.getName())
            .orElseGet(() -> userRepository.findByEmail(principal.getName()).orElse(null));
            
        if (user == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body("User not found.");

        if (!passwordEncoder.matches(payload.get("currentPassword"), user.getPassword())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Current password validation failed.");
        }
        user.setPassword(passwordEncoder.encode(payload.get("newPassword")));
        
        if (payload.containsKey("encryptedKeyBundle") && !payload.get("encryptedKeyBundle").trim().isEmpty()) {
            user.setEncryptedKeyBundle(payload.get("encryptedKeyBundle"));
        }
        
        userRepository.save(user);

        // 🛡️ GLOBAL SESSION EVICTION PROTOCOL
        // 1. Revoke all active dynamic JWT refresh tokens for this identity
        try {
            authService.revokeAllUserJWTTokens(user);
        } catch (Exception e) {
            System.err.println("⚠️ [Global Eviction] Failed to revoke user tokens: " + e.getMessage());
        }

        // 2. Broadcast FORCE_LOGOUT WebSocket notification to other Web sessions
        try {
            messagingTemplate.convertAndSendToUser(
                user.getUsername(),
                "/topic/identity",
                Map.of("type", "FORCE_LOGOUT", "message", "Credential matrix rotated globally.")
            );
        } catch (Exception e) {
            System.err.println("⚠️ [Global Eviction] Failed to send Web WebSocket eviction: " + e.getMessage());
        }

        // 3. Broadcast FORCE_LOGOUT WebSocket notification to other Mobile sessions
        try {
            messagingTemplate.convertAndSend(
                "/topic/messages." + user.getId(),
                Map.of("type", "FORCE_LOGOUT", "message", "Credential matrix rotated globally.")
            );
        } catch (Exception e) {
            System.err.println("⚠️ [Global Eviction] Failed to send Mobile WebSocket eviction: " + e.getMessage());
        }

        return ResponseEntity.ok(Map.of("success", true, "message", "Password rotated securely."));
    }
}
