package com.example.prama.controller;

import com.example.prama.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;

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
}
