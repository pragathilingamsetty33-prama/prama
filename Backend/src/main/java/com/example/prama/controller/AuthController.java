package com.example.prama.controller;

import com.example.prama.dto.AuthRequest;
import com.example.prama.dto.AuthResponse;
import com.example.prama.dto.RefreshTokenRequest;
import com.example.prama.dto.RegisterRequest;
import com.example.prama.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.example.prama.repository.UserRepository;
import com.example.prama.entity.User;
import java.util.HashMap;
import java.util.Map;


@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final UserRepository userRepository;
    private final org.springframework.messaging.simp.user.SimpUserRegistry simpUserRegistry;
    private final com.example.prama.security.WebSocketSessionHolder webSocketSessionHolder;
    private final org.springframework.messaging.simp.SimpMessagingTemplate messagingTemplate;


    @PostMapping("/register")
    public ResponseEntity<String> register(
            @RequestBody RegisterRequest request
    ) {
        return ResponseEntity.ok(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> authenticate(
            @RequestBody AuthRequest request
    ) {
        AuthResponse auth = authService.authenticate(request);
        Map<String, Object> response = new HashMap<>();
        response.put("accessToken", auth.getAccessToken());
        response.put("refreshToken", auth.getRefreshToken());
        response.put("userId", auth.getUserId());
        response.put("username", auth.getUsername());
        response.put("email", auth.getEmail());
        
        // 📊 PHASE 8: AUTHENTICATED PROFILE HANDSHAKE SYNCHRONIZATION
        userRepository.findById(auth.getUserId()).ifPresent(user -> {
            response.put("avatar", user.getAvatar());
        });

        return ResponseEntity.ok(response);
    }


    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refreshToken(
            @RequestBody RefreshTokenRequest request
    ) {
        return ResponseEntity.ok(authService.refreshToken(request));
    }

    @org.springframework.web.bind.annotation.PostMapping("/update-password")
    public ResponseEntity<Map<String, Object>> updatePassword(
            @RequestBody com.example.prama.dto.PasswordRotationRequest request,
            org.springframework.security.core.Authentication authentication) {
        
        if (authentication == null || !(authentication.getPrincipal() instanceof User currentUser)) {
            return ResponseEntity.status(org.springframework.http.HttpStatus.UNAUTHORIZED).build();
        }

        java.util.UUID userId = currentUser.getId();
        
        // 1. Core Cryptographic Mutation: Update credentials and increment vault_version
        int newVaultVersion = authService.rotateUserPassword(userId, request.getNewPassword());

        // Default-Secure Architecture: Opt-out flag dictates execution path
        boolean isBreachPath = !"ROUTINE".equalsIgnoreCase(request.getRotationIntent());

        if (isBreachPath) {
            // PATH BETA: Sovereign Purge (The Incident Response Kill-Switch)
            authService.revokeAllUserJWTTokens(currentUser);
            
            // Physical TCP Stream Disconnection
            if (simpUserRegistry.getUser(currentUser.getUsername()) != null) {
                simpUserRegistry.getUser(currentUser.getUsername()).getSessions().forEach(simpSession -> {
                    org.springframework.web.socket.WebSocketSession nativeSession = webSocketSessionHolder.get(simpSession.getId());
                    if (nativeSession != null && nativeSession.isOpen()) {
                        try {
                            // Ruthlessly close the persistent TCP pipe citing a policy violation
                            nativeSession.close(org.springframework.web.socket.CloseStatus.POLICY_VIOLATION);
                        } catch (Exception e) {
                            // Fail-silent on socket close to protect thread pool execution
                        } finally {
                            webSocketSessionHolder.remove(simpSession.getId());
                        }
                    }
                });
            }
            return ResponseEntity.ok(Map.of("status", "PURGED", "vaultVersion", newVaultVersion));
        }

        // PATH ALPHA: Routine Graceful Re-Wrap
        messagingTemplate.convertAndSendToUser(
                currentUser.getUsername(),
                "/topic/identity",
                Map.of("type", "IDENTITY_EPOCH_ROTATED", "vaultVersion", newVaultVersion)
        );
        return ResponseEntity.ok(Map.of("status", "SUCCESS", "vaultVersion", newVaultVersion));
    }

    @org.springframework.web.bind.annotation.GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("OK");
    }
}
