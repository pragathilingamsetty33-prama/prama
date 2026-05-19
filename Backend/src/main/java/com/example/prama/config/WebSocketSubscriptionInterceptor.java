package com.example.prama.config;

import com.example.prama.entity.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
@RequiredArgsConstructor
@Slf4j
public class WebSocketSubscriptionInterceptor implements ChannelInterceptor {

    private final JdbcTemplate jdbcTemplate;
    private final ConcurrentHashMap<String, Boolean> membershipCache = new ConcurrentHashMap<>();

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null && StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            String destination = accessor.getDestination();

            // Intercept group subscriptions: /topic/group.{groupId}
            if (destination != null && destination.startsWith("/topic/group.")) {
                String groupIdStr = destination.substring("/topic/group.".length());
                Authentication auth = (Authentication) accessor.getUser();

                if (auth != null && auth.getPrincipal() instanceof User) {
                    User currentUser = (User) auth.getPrincipal();
                    UUID userId = currentUser.getId();

                    try {
                        UUID groupId = UUID.fromString(groupIdStr);
                        String cacheKey = userId + "_" + groupId;

                        // 🛡️ High-speed In-Memory Cache Lookup (Neutralizes Thundering Herd)
                        boolean isMember = membershipCache.computeIfAbsent(cacheKey, key -> {
                            String sql = "SELECT COUNT(*) FROM group_members WHERE group_id = ? AND user_id = ?";
                            Integer count = jdbcTemplate.queryForObject(sql, Integer.class, groupId, userId);
                            return count != null && count > 0;
                        });

                        if (!isMember) {
                            log.warn("🛡️ [Subscription Blocked]: User {} blocked from unauthorized topic {}", 
                                currentUser.getEmail(), destination);
                            // Returning null silently consumes the SUBSCRIBE frame, leaving socket intact!
                            return null;
                        }
                    } catch (Exception e) {
                        log.error("❌ [Subscription Gate Error]: Failed to validate subscription mapping: {}", e.getMessage());
                        return null; // Consume frame silently on format errors
                    }
                } else {
                    log.warn("🛡️ [Subscription Gate]: Subscription attempt without active Authentication context.");
                    return null;
                }
            }
        }
        return message;
    }

    /**
     * Evicts a specific user's membership cache record.
     * Invoked atomically during eviction events.
     */
    public void evictCacheKey(String cacheKey) {
        membershipCache.remove(cacheKey);
        log.info("🛡️ [Cache Eviction]: Cleared stale membership key {} from memory.", cacheKey);
    }
}
