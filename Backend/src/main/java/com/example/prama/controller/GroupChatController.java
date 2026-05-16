package com.example.prama.controller;

import com.example.prama.dto.ChatMessage;
import com.example.prama.dto.GroupMessagePacket;
import com.example.prama.entity.User;
import com.example.prama.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class GroupChatController {

    private final SimpMessagingTemplate messagingTemplate;
    private final JdbcTemplate jdbcTemplate;

    /**
     * Endpoint to fetch all member public keys for N-Wrap encryption.
     */
    @GetMapping("/api/v1/groups/{groupId}/roster-keys")
    public List<Map<String, Object>> getGroupRosterKeys(@PathVariable("groupId") String groupIdStr) {
        UUID groupId = UUID.fromString(groupIdStr);
        String sql = "SELECT u.id as \"userId\", u.public_key as \"publicKey\", u.username as \"username\", gm.last_read_at as \"lastReadAt\", gm.is_admin as \"isAdmin\" " +
                     "FROM prama_users u " +
                     "JOIN group_members gm ON u.id = gm.user_id " +
                     "WHERE gm.group_id = ?";
        return jdbcTemplate.queryForList(sql, groupId);
    }

    // ============================================================================
    // AUTHENTICATED MULTI-ADMIN PROMOTION ENDPOINT (PHASE 3)
    // ============================================================================
    @PutMapping("/api/v1/groups/{groupId}/promote/{userId}")
    @org.springframework.transaction.annotation.Transactional
    public ResponseEntity<?> promoteToAdmin(@PathVariable String groupId, @PathVariable String userId, Principal principal) {
        System.out.println("🦅 [EAGLE EYE - BACKEND] Admin promotion request intercepted for Group: " + groupId + " -> Target User: " + userId);
        String callerIdentity = principal.getName();
        
        // 1. Security Gate: Verify the executing user is already a certified admin
        Integer count = jdbcTemplate.queryForObject(
            "SELECT count(*) FROM group_members gm JOIN prama_users u ON gm.user_id = u.id " +
            "WHERE gm.group_id = ?::uuid AND (u.username = ? OR u.email = ?) AND gm.is_admin = true",
            Integer.class, groupId, callerIdentity, callerIdentity
        );
            
        if (count == null || count == 0) {
            System.err.println("❌ [SECURITY VIOLATION] Non-admin principal identity attempted to invoke promotion pipeline.");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Access denied: Admin authorization required.");
        }
        
        // 2. Mutate the target membership record role status
        int updated = jdbcTemplate.update(
            "UPDATE group_members SET is_admin = true WHERE group_id = ?::uuid AND user_id = ?::uuid",
            groupId, userId
        );
        
        if (updated == 0) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Target user profile is not a registered member of this group.");
        }
        
        System.out.println("🦅 [EAGLE EYE - BACKEND] Role table updated in DB. Dispatching STOMP sync notification...");
        
        // 3. Real-Time Sync Broadcast
        Map<String, Object> rolePacket = new HashMap<>();
        rolePacket.put("type", "ROLE_UPDATED");
        rolePacket.put("groupId", groupId);
        rolePacket.put("userId", userId);
        rolePacket.put("newRole", "ADMIN");
        
        messagingTemplate.convertAndSend("/topic/group." + groupId, rolePacket);
        
        return ResponseEntity.ok().body(Map.of("success", true, "promotedUserId", userId));
    }

    // ============================================================================
    // AUTHENTICATED ADD MEMBER & E2EE KEY PERSISTENCE ENDPOINT (PHASE 4)
    // ============================================================================
    @PostMapping("/api/v1/groups/{groupId}/addMember")
    @org.springframework.transaction.annotation.Transactional
    public ResponseEntity<?> addMemberToGroup(@PathVariable String groupId, @RequestBody Map<String, String> payload, Principal principal) {
        System.out.println("🦅 [EAGLE EYE - CRYPTO] Intercepted group inclusion pipeline request for Group ID: " + groupId);
        String executorName = principal.getName();
        String targetFriendId = payload.get("friendId");
        String encryptedKeyPayload = payload.get("encryptedGroupKey"); // Admin-wrapped AES key
        
        // 1. Security Gate: Verify caller is an Admin of this targeted group
        Integer adminCount = jdbcTemplate.queryForObject(
            "SELECT count(*) FROM group_members gm JOIN prama_users u ON gm.user_id = u.id " +
            "WHERE gm.group_id = ?::uuid AND (u.username = ? OR u.email = ?) AND gm.is_admin = true",
            Integer.class, groupId, executorName, executorName
        );
            
        if (adminCount == null || adminCount == 0) {
            System.err.println("❌ [SECURITY RETRACTION] Non-admin context denied access to membership modification tools.");
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("Unauthorized operation: Admin role confirmation required.");
        }
        
        // 2. Prevent Double Insertion Faults
        Integer exists = jdbcTemplate.queryForObject(
            "SELECT count(*) FROM group_members WHERE group_id = ?::uuid AND user_id = ?::uuid",
            Integer.class, groupId, targetFriendId
        );
        if (exists != null && exists > 0) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body("Target user profile is already a registered group participant.");
        }
        
        // 3. Persist Membership & Wrapped Key
        jdbcTemplate.update(
            "INSERT INTO group_members (group_id, user_id, is_admin, encrypted_group_key) VALUES (?::uuid, ?::uuid, false, ?)",
            groupId, targetFriendId, encryptedKeyPayload
        );
        
        // 4. Resolve Target Info for Broadcast
        Map<String, Object> targetUser = jdbcTemplate.queryForMap(
            "SELECT id, username FROM prama_users WHERE id = ?::uuid",
            targetFriendId
        );
        
        System.out.println("🦅 [EAGLE EYE - NETWORK] Membership records committed. Dispatching broadcast notification token...");
        
        // 5. Broadcast Real-Time Sync Packet
        Map<String, Object> syncPacket = new HashMap<>();
        syncPacket.put("type", "MEMBER_ADDED");
        syncPacket.put("groupId", groupId);
        syncPacket.put("newMember", Map.of(
            "userId", targetUser.get("id").toString(),
            "username", targetUser.get("username"),
            "isAdmin", false
        ));
        
        messagingTemplate.convertAndSend("/topic/group." + groupId, syncPacket);
        return ResponseEntity.ok().body(Map.of("success", true, "message", "User integrated cleanly into cryptographic roster context."));
    }

    /**
     * Handles incoming GroupMessagePackets and fanned-out delivery.
     * ZERO-KNOWLEDGE: The server only sees individual wrapped keys and routes them.
     */
    @MessageMapping("/chat.groupMessage")
    @org.springframework.transaction.annotation.Transactional
    public void processGroupMessage(@Payload GroupMessagePacket packet, SimpMessageHeaderAccessor headerAccessor) {
        UsernamePasswordAuthenticationToken auth = (UsernamePasswordAuthenticationToken) headerAccessor.getUser();
        if (auth == null) throw new RuntimeException("Unauthorized");

        User sender = (User) auth.getPrincipal();
        packet.setSenderId(sender.getId()); // Defensive force-injection to eliminate nulls
        
        Instant now = Instant.now();
        String timestampStr = now.toString();
        UUID messageId = UUID.randomUUID();

        // 1. Persist the master message record
            
        jdbcTemplate.update(
            "INSERT INTO group_messages (id, group_id, sender_id, encrypted_message, iv, tag, timestamp) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?)",
            messageId, 
            packet.getGroupId(), 
            sender.getId(), 
            packet.getEncryptedContent(), 
            packet.getIv(), 
            packet.getTag(), 
            java.sql.Timestamp.from(now)
        );

        // 2. Perform "Fan-Out" delivery: iterate through wrapped keys, persist them, and send STOMP messages
        packet.getWrappedKeys().forEach((recipientId, wrappedKey) -> {
            // A. Persist the key for recovery
            jdbcTemplate.update(
                "INSERT INTO group_message_keys (message_id, user_id, encrypted_key) VALUES (?::uuid, ?::text, ?)",
                messageId, 
                recipientId.toString(), 
                wrappedKey
            );

            // B. Construct a standard ChatMessage for real-time delivery
            ChatMessage personalizedMessage = ChatMessage.builder()
                    .id(messageId)
                    .senderId(sender.getId())
                    .recipientId(recipientId)
                    .groupId(packet.getGroupId())
                    .encryptedContent(packet.getEncryptedContent())
                    .encryptedAESKey(wrappedKey)
                    .iv(packet.getIv())
                    .tag(packet.getTag())
                    .timestamp(timestampStr)
                    .build();

            // C. Route to the recipient's personal STOMP topic
            messagingTemplate.convertAndSend(
                    "/topic/messages." + recipientId.toString(),
                    personalizedMessage
            );
        });

        // 3. Broadcast to the group topic for active UI synchronization
        // Note: This contains the master packet which clients can use if they are active
        messagingTemplate.convertAndSend("/topic/group." + packet.getGroupId().toString(), packet);
    }
}
