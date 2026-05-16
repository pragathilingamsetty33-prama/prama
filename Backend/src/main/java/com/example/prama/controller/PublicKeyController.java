package com.example.prama.controller;

import com.example.prama.entity.User;
import com.example.prama.entity.UserPublicKey;
import com.example.prama.repository.PublicKeyRepository;
import com.example.prama.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.Optional;

@RestController
@RequestMapping("/api/v1/users/keys")
@CrossOrigin(origins = "*")
public class PublicKeyController {

    private final PublicKeyRepository publicKeyRepository;
    private final UserRepository userRepository;

    public PublicKeyController(PublicKeyRepository publicKeyRepository, UserRepository userRepository) {
        this.publicKeyRepository = publicKeyRepository;
        this.userRepository = userRepository;
    }

    /**
     * Upload or update the current user's RSA Public Key.
     */
    @PostMapping
    public ResponseEntity<?> uploadPublicKey(@RequestBody String publicKey) {
        String currentUsername = SecurityContextHolder.getContext().getAuthentication().getName();
        Optional<User> userOpt = userRepository.findByUsername(currentUsername);

        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body("User not found");
        }

        User user = userOpt.get();
        UserPublicKey userPublicKey = publicKeyRepository.findById(user.getId())
                .orElse(new UserPublicKey());
        
        userPublicKey.setUser(user);
        userPublicKey.setPublicKey(publicKey);
        publicKeyRepository.save(userPublicKey);

        return ResponseEntity.ok("Public key updated successfully");
    }

    /**
     * Retrieve the public key of a specific user for E2EE encryption.
     */
    @GetMapping("/{userId}")
    public ResponseEntity<?> getPublicKey(@PathVariable java.util.UUID userId) {
        return publicKeyRepository.findById(userId)
                .map(key -> ResponseEntity.ok(key.getPublicKey()))
                .orElse(ResponseEntity.notFound().build());
    }
}
