package com.example.prama.controller;

import com.example.prama.dto.FriendDTO;
import com.example.prama.service.FriendService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/friends")
@RequiredArgsConstructor
public class FriendController {

    private final FriendService friendService;

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
}
