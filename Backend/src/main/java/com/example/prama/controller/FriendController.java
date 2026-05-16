package com.example.prama.controller;

import com.example.prama.dto.FriendDTO;
import com.example.prama.service.FriendService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import com.example.prama.entity.Friendship;
import com.example.prama.entity.User;
import com.example.prama.repository.FriendshipRepository;
import com.example.prama.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/friends")
@RequiredArgsConstructor
public class FriendController {

    private final FriendService friendService;
    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;

    @PostMapping("/request/{username}")
    public ResponseEntity<Void> sendFriendRequest(@PathVariable String username, Authentication authentication) {
        friendService.sendFriendRequest(authentication.getName(), username);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/accept/{requestId}")
    public ResponseEntity<Void> acceptFriendRequest(@PathVariable UUID requestId, Authentication authentication) {
        friendService.acceptFriendRequest(authentication.getName(), requestId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/requests")
    public ResponseEntity<List<FriendDTO>> getPendingRequests(Authentication authentication) {
        return ResponseEntity.ok(friendService.getPendingRequests(authentication.getName()));
    }

    @GetMapping
    public ResponseEntity<List<FriendDTO>> getFriends(Authentication authentication) {
        return ResponseEntity.ok(friendService.getFriends(authentication.getName()));
    }

    @PutMapping("/{friendId}/alias")
    @Transactional
    public ResponseEntity<?> setFriendAlias(@PathVariable UUID friendId, @RequestBody Map<String, String> payload, Principal principal) {
        User currentUser = userRepository.findByUsername(principal.getName())
            .orElseGet(() -> userRepository.findByEmail(principal.getName()).orElse(null));
        
        User friendUser = userRepository.findById(friendId).orElse(null);
        if (friendUser == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Friend not found.");

        Friendship friendship = friendshipRepository.findFriendshipBetweenUsers(currentUser, friendUser)
            .orElseThrow(() -> new RuntimeException("Friendship link not found."));
            
        if (friendship.getSender().getId().equals(currentUser.getId())) {
            friendship.setReceiverAlias(payload.get("alias"));
        } else {
            friendship.setSenderAlias(payload.get("alias"));
        }
        friendshipRepository.save(friendship);
        return ResponseEntity.ok(Map.of("success", true, "alias", payload.get("alias")));
    }

    // ============================================================================
    // GHOST PROTOCOL RELATIONSHIP TERMINATION (PHASE 8 ADDITION)
    // ============================================================================
    @DeleteMapping("/{friendId}/terminate")
    @Transactional
    public ResponseEntity<?> terminateFriendshipContext(@PathVariable UUID friendId, Principal principal) {
        User currentUser = userRepository.findByUsername(principal.getName())
            .orElseGet(() -> userRepository.findByEmail(principal.getName()).orElse(null));
            
        if (currentUser == null) return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Context lost.");

        // Expunge record so incoming messages fail the relationship contract check
        friendshipRepository.findByUserIds(currentUser.getId(), friendId).ifPresent(friendshipRepository::delete);
        
        System.out.println("🤫 [GHOST PROTOCOL] Friendship severed safely by: " + currentUser.getUsername());
        return ResponseEntity.ok(java.util.Map.of("success", true));
    }
}

