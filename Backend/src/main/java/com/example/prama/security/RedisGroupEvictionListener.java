package com.example.prama.security;

import com.example.prama.config.WebSocketSubscriptionInterceptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.messaging.simp.user.SimpSession;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class RedisGroupEvictionListener {

    private final SimpUserRegistry simpUserRegistry;
    private final RealTimeSubscriptionEnforcer subscriptionEnforcer;
    private final WebSocketSubscriptionInterceptor subscriptionInterceptor;

    /**
     * Triggered node-wide instantly upon receiving a MEMBER_EVICTED cluster signal.
     */
    public void onGroupEvictionReceived(String evictedUserId, String groupId) {
        log.info("📡 [Redis Eviction Listener]: Received eviction broadcast for user {} in group {}", 
            evictedUserId, groupId);

        // 1. Atomically invalidate localized membership cache key to prevent stale cache handshakes
        String cacheKey = evictedUserId + "_" + groupId;
        subscriptionInterceptor.evictCacheKey(cacheKey);

        // 2. Convert database user ID into active memory-mapped session handles
        SimpUser simpUser = simpUserRegistry.getUser(evictedUserId);

        if (simpUser != null) {
            // Sever all active tabs and connections
            for (SimpSession session : simpUser.getSessions()) {
                subscriptionEnforcer.exciseGroupSubscription(session.getId(), groupId);
            }
            log.info("🛡️ [Broker Severance]: Completed node-wide subscription excision for user {}", evictedUserId);
        } else {
            log.info("ℹ️ [Broker Severance]: User {} has no active connections on this node.", evictedUserId);
        }
    }
}
