package com.example.prama.controller;

import com.example.prama.entity.GroupSessionEnvelope;
import com.example.prama.entity.User;
import com.example.prama.repository.GroupSessionEnvelopeRepository;
import com.example.prama.repository.PublicKeyRepository;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/group-sessions")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
@Slf4j
public class GroupSessionController {

    private final JdbcTemplate jdbcTemplate;
    private final PublicKeyRepository publicKeyRepository;
    private final GroupSessionEnvelopeRepository envelopeRepository;

    /**
     * POST /api/v1/group-sessions/distribute
     * Distributes bulk Group Session Envelopes to group members.
     */
    @PostMapping("/distribute")
    @Transactional
    public ResponseEntity<?> distributeGroupSessions(@RequestBody GroupSessionDistributionRequest request) {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        UUID currentUserId = currentUser.getId();

        try {
            UUID groupId = UUID.fromString(request.getGroupId());
            UUID senderSessionId = UUID.fromString(request.getSenderSessionId());

            // 🛡️ Gate 1: Roster Membership validation (requester must belong to group)
            String membershipCheckSql = "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND user_id = ?";
            Integer requesterCount = jdbcTemplate.queryForObject(membershipCheckSql, Integer.class, groupId, currentUserId);
            if (requesterCount == null || requesterCount == 0) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Access Denied: You are not a member of this group."));
            }

            // Fetch expected group members (excluding the sender themselves)
            String rosterSql = "SELECT user_id FROM group_members WHERE group_id = ?";
            List<UUID> rosterIds = jdbcTemplate.queryForList(rosterSql, UUID.class, groupId);
            Set<UUID> expectedRecipients = rosterIds.stream()
                .filter(id -> !id.equals(currentUserId))
                .collect(Collectors.toSet());

            // 🛡️ Gate 2: Roster Integrity validation (must cover all recipients exactly)
            Set<UUID> requestRecipientIds = request.getEnvelopes().stream()
                .map(env -> UUID.fromString(env.getRecipientId()))
                .collect(Collectors.toSet());

            if (!requestRecipientIds.equals(expectedRecipients)) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Validation Failed: Recipient envelopes list does not match group membership roster."));
            }

            // 🛡️ Gate 3: Structural Identity verification (ensure public keys exist)
            for (EnvelopeDTO envelopeDto : request.getEnvelopes()) {
                UUID recipientId = UUID.fromString(envelopeDto.getRecipientId());
                if (!publicKeyRepository.existsById(recipientId)) {
                    return ResponseEntity.badRequest()
                        .body(Map.of("error", "Validation Failed: Recipient " + recipientId + " does not have a registered public key."));
                }
            }

            // 🔄 Step 4: Atomic State Invalidation (mark legacy active envelopes for this sender as inactive)
            envelopeRepository.invalidateLegacyEnvelopes(groupId.toString(), currentUserId.toString());

            // 💾 Step 5: Hibernate Bulk Persistent insertion (utilizing pre-allocated UUIDs as String keys)
            List<GroupSessionEnvelope> envelopesToSave = new ArrayList<>();
            for (EnvelopeDTO envelopeDto : request.getEnvelopes()) {
                byte[] decodedPayload = Base64.getDecoder().decode(envelopeDto.getEncryptedPayloadBase64());
                
                GroupSessionEnvelope envelope = GroupSessionEnvelope.builder()
                    .id(UUID.randomUUID().toString()) // Pre-allocated UUID prevents IDENTITY batch locks
                    .groupId(groupId.toString())
                    .senderId(currentUserId.toString())
                    .senderSessionId(senderSessionId.toString())
                    .recipientId(envelopeDto.getRecipientId())
                    .identityKeyVersion(envelopeDto.getIdentityKeyVersion())
                    .encryptedPayload(decodedPayload) // Binary BYTEA layout
                    .isActive(true)
                    .build();
                
                envelopesToSave.add(envelope);
            }

            envelopeRepository.saveAll(envelopesToSave);

            log.info("🛡️ [Session Distribution]: Successfully saved {} session key envelopes for group {} by sender {}", 
                envelopesToSave.size(), groupId, currentUserId);

            return ResponseEntity.ok(Map.of(
                "status", "SUCCESS",
                "envelopesProcessed", envelopesToSave.size()
            ));

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid format: " + e.getMessage()));
        } catch (Exception e) {
            log.error("❌ [Session Distribution Error]: Failed to distribute group sessions: ", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error: " + e.getMessage()));
        }
    }

    /**
     * GET /api/v1/group-sessions/active-envelopes
     * Fetches active envelopes addressed to the current user for a specific group.
     */
    @GetMapping("/active-envelopes")
    public ResponseEntity<?> getActiveEnvelopes(@RequestParam("groupId") String groupIdStr) {
        User currentUser = (User) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        UUID currentUserId = currentUser.getId();

        try {
            UUID groupId = UUID.fromString(groupIdStr);

            // Verify membership of the caller
            String membershipCheckSql = "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND user_id = ?";
            Integer requesterCount = jdbcTemplate.queryForObject(membershipCheckSql, Integer.class, groupId, currentUserId);
            if (requesterCount == null || requesterCount == 0) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "Access Denied: You are not a member of this group."));
            }

            // Query active envelopes from index using high-speed composite scan
            String sql = "SELECT id, group_id, sender_id, sender_session_id, recipient_id, identity_key_version, encrypted_payload " +
                         "FROM group_session_envelopes " +
                         "WHERE group_id = ? AND recipient_id = ? AND is_active = true";

            List<Map<String, Object>> envelopes = jdbcTemplate.query(sql, (rs, rowNum) -> {
                Map<String, Object> map = new HashMap<>();
                map.put("envelopeId", rs.getString("id"));
                map.put("groupId", rs.getString("group_id"));
                map.put("senderId", rs.getString("sender_id"));
                map.put("senderSessionId", rs.getString("sender_session_id"));
                map.put("recipientId", rs.getString("recipient_id"));
                map.put("identityKeyVersion", rs.getInt("identity_key_version"));
                
                // Return payload as Base64 for safe JSON transport over HTTP JSON
                byte[] payloadBytes = rs.getBytes("encrypted_payload");
                map.put("encryptedPayloadBase64", Base64.getEncoder().encodeToString(payloadBytes));
                return map;
            }, groupId.toString(), currentUserId.toString());

            return ResponseEntity.ok(envelopes);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid groupId format: " + e.getMessage()));
        } catch (Exception e) {
            log.error("❌ [Active Envelopes Error]: Failed to fetch active envelopes: ", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error: " + e.getMessage()));
        }
    }

    // --- DTO Classes ---

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GroupSessionDistributionRequest {
        private String groupId;
        private String senderSessionId;
        private List<EnvelopeDTO> envelopes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EnvelopeDTO {
        private String recipientId;
        private Integer identityKeyVersion;
        private String encryptedPayloadBase64;
    }
}
