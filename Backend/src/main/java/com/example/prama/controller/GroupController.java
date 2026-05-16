package com.example.prama.controller;

import com.example.prama.dto.GroupRequestDTO;
import com.example.prama.entity.User;
import com.example.prama.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/groups")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class GroupController {

    private final JdbcTemplate jdbcTemplate;
    private final UserRepository userRepository;

    /**
     * Fetch groups the current user belongs to.
     */
    @GetMapping("/my-groups")
    public ResponseEntity<List<com.example.prama.dto.GroupDTO>> getMyGroups() {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();

        String sql = "SELECT g.group_id, g.name, g.group_avatar, " +
                     "(SELECT count(*) FROM group_members WHERE group_id = g.group_id) as member_count " +
                     "FROM groups g " +
                     "JOIN group_members gm ON g.group_id = gm.group_id " +
                     "WHERE gm.user_id = ?";

        List<com.example.prama.dto.GroupDTO> groups = jdbcTemplate.query(sql, (rs, rowNum) -> 
            com.example.prama.dto.GroupDTO.builder()
                .groupId(UUID.fromString(rs.getString("group_id")))
                .name(rs.getString("name"))
                .groupAvatar(rs.getString("group_avatar"))
                .memberCount(rs.getLong("member_count"))
                .build(), 
            currentUser.getId()
        );
        return ResponseEntity.ok(groups);
    }


    /**
     * Create a new group and add initial members.
     */
    @PostMapping
    @Transactional
    public ResponseEntity<?> createGroup(@RequestBody GroupRequestDTO request) {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        UUID groupId = UUID.randomUUID();

        // 1. Create the group record
        jdbcTemplate.update(
                "INSERT INTO groups (group_id, name, members_can_add) VALUES (?::uuid, ?, ?)",
                groupId, request.getName(), false
        );

        // 2. Add creator as admin
        jdbcTemplate.update(
                "INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?::uuid, ?::uuid, true)",
                groupId, currentUser.getId()
        );

        // 3. Add other members
        if (request.getMemberIds() != null) {
            for (UUID memberId : request.getMemberIds()) {
                if (!memberId.equals(currentUser.getId())) {
                    jdbcTemplate.update(
                            "INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?::uuid, ?::uuid, false)",
                            groupId, memberId
                    );
                }
            }
        }

        return ResponseEntity.ok(Map.of("groupId", groupId, "name", request.getName()));
    }

    /**
     * Add a member to the group.
     * Logic: (requester.is_admin || group.members_can_add)
     */
    @PostMapping("/{groupId}/members")
    public ResponseEntity<?> addMember(@PathVariable UUID groupId, @RequestBody Map<String, Object> body) {
        UUID targetUserId = UUID.fromString(body.get("userId").toString());
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();

        // 1. Check requester permissions
        Map<String, Object> groupInfo = jdbcTemplate.queryForMap(
                "SELECT members_can_add FROM groups WHERE group_id = ?", groupId);
        
        Map<String, Object> requesterMember = jdbcTemplate.queryForMap(
                "SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?",
                groupId, currentUser.getId());

        boolean isAdmin = (boolean) requesterMember.get("is_admin");
        boolean canAdd = (boolean) groupInfo.get("members_can_add");

        if (!isAdmin && !canAdd) {
            return ResponseEntity.status(403).body("You do not have permission to invite members to this group.");
        }

        // 2. Add the member
        jdbcTemplate.update(
                "INSERT INTO group_members (group_id, user_id, is_admin, joined_at) VALUES (?::uuid, ?::uuid, ?, CURRENT_TIMESTAMP) " +
                "ON CONFLICT (group_id, user_id) DO NOTHING",
                groupId, targetUserId, false);

        return ResponseEntity.ok("Member added successfully");
    }

    /**
     * Update group settings (e.g. toggle members_can_add).
     * Logic: Admin-only.
     */
    @PatchMapping("/{groupId}/settings")
    public ResponseEntity<?> updateSettings(@PathVariable UUID groupId, @RequestBody Map<String, Object> body) {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();

        boolean isAdmin = jdbcTemplate.queryForObject(
                "SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?",
                Boolean.class, groupId, currentUser.getId());

        if (!isAdmin) {
            return ResponseEntity.status(403).body("Only admins can modify group settings.");
        }

        if (body.containsKey("membersCanAdd")) {
            jdbcTemplate.update("UPDATE groups SET members_can_add = ? WHERE group_id = ?::uuid",
                    body.get("membersCanAdd"), groupId);
        }

        return ResponseEntity.ok("Settings updated");
    }

    /**
     * Remove a member from the group.
     * Logic: Admin-only.
     */
    @DeleteMapping("/{groupId}/members/{userId}")
    public ResponseEntity<?> removeMember(@PathVariable UUID groupId, @PathVariable UUID userId) {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();

        boolean isAdmin = jdbcTemplate.queryForObject(
                "SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?",
                Boolean.class, groupId, currentUser.getId());

        if (!isAdmin) {
            return ResponseEntity.status(403).body("Only admins can remove members.");
        }

        jdbcTemplate.update("DELETE FROM group_members WHERE group_id = ?::uuid AND user_id = ?::uuid", groupId, userId);
        return ResponseEntity.ok("Member removed");
    }

    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Mark a group chat as read for the current user.
     * High-Water Mark: Updates last_read_at in group_members.
     */
    @PostMapping("/{groupId}/read")
    public ResponseEntity<?> markAsRead(@PathVariable UUID groupId) {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        
        jdbcTemplate.update(
                "UPDATE group_members SET last_read_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ?",
                groupId, currentUser.getId());

        // BROADCAST to live sync topic
        String destination = "/topic/group." + groupId;
        com.example.prama.dto.ReceiptPacket packet = com.example.prama.dto.ReceiptPacket.builder()
                .groupId(groupId)
                .recipientId(currentUser.getId()) // The person who read it
                .status("READ")
                .timestamp(java.time.Instant.now().toString())
                .type("RECEIPT_UPDATE")
                .build();

        messagingTemplate.convertAndSend(destination, packet);

        return ResponseEntity.ok("Group marked as read");
    }

    /**
     * Fetch group message history.
     * ZERO-KNOWLEDGE: Strictly filtered by joined_at to prevent history leaks.
     */
    @GetMapping("/{groupId}/messages")
    public ResponseEntity<List<Map<String, Object>>> getGroupHistory(@PathVariable("groupId") String groupIdStr) {
        UUID groupId = UUID.fromString(groupIdStr);
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();

        // 1. Get the user's join timestamp
        Map<String, Object> membership = jdbcTemplate.queryForMap(
                "SELECT joined_at FROM group_members WHERE group_id = ? AND user_id = ?",
                groupId, currentUser.getId());
        
        Object joinedAt = membership.get("joined_at");

        // 2. Fetch only messages sent AFTER the user joined.
        // Return the specific user's key inside a 'wrappedKeys' map to match frontend expectations.
        String sql = "SELECT gm.id, gm.group_id as \"groupId\", gm.sender_id as \"senderId\", " +
                     "gm.encrypted_message as \"encryptedContent\", gm.iv, gm.tag, gm.timestamp, " +
                     "json_build_object(?::text, gmk.encrypted_key) as \"wrappedKeys\" " +
                     "FROM group_messages gm " +
                     "JOIN group_message_keys gmk ON gm.id = gmk.message_id " +
                     "WHERE gm.group_id = ? AND gmk.user_id = ?::text AND gm.timestamp >= ? " +
                     "ORDER BY gm.timestamp ASC";
 
        List<Map<String, Object>> messages = jdbcTemplate.queryForList(sql, currentUser.getId().toString(), groupId, currentUser.getId().toString(), joinedAt);
 
        return ResponseEntity.ok(messages);
    }
}
