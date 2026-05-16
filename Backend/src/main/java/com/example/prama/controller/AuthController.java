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

    @org.springframework.web.bind.annotation.GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("OK");
    }
}
