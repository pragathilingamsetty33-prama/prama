package com.example.prama.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationListener;
import org.springframework.messaging.simp.broker.BrokerAvailabilityEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import com.example.prama.security.WebSocketSessionHolder;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Component
@RequiredArgsConstructor
@Slf4j
public class BrokerAvailabilityGuard implements ApplicationListener<BrokerAvailabilityEvent> {

    private final WebSocketSessionHolder webSocketSessionHolder;
    
    // Self-contained Cached Thread Pool to process async evictions without executor queue capacity failures
    private final ExecutorService evictionExecutor = Executors.newCachedThreadPool();
    private static final int BATCH_SIZE = 100;

    @Override
    public void onApplicationEvent(BrokerAvailabilityEvent event) {
        if (!event.isBrokerAvailable()) {
            log.error("🚨 [Broker Guard] RabbitMQ broker is offline! Starting batched, thread-pooled session eviction.");

            // Convert sessions map to list
            List<WebSocketSession> sessions = new ArrayList<>(webSocketSessionHolder.getActiveSessions().values());
            int totalSessions = sessions.size();

            if (totalSessions == 0) {
                log.info("[Broker Guard] No active WebSocket sessions to evict.");
                return;
            }

            log.info("[Broker Guard] Evicting {} active sessions in batches of {}", totalSessions, BATCH_SIZE);

            // Chunk sessions into batches of BATCH_SIZE to protect task queue capacities
            for (int i = 0; i < totalSessions; i += BATCH_SIZE) {
                final List<WebSocketSession> batch = sessions.subList(i, Math.min(i + BATCH_SIZE, totalSessions));

                evictionExecutor.submit(() -> {
                    for (WebSocketSession session : batch) {
                        try {
                            if (session.isOpen()) {
                                // 1011 indicates Server Error (e.g. Broker relay down)
                                session.close(new CloseStatus(1011, "MESSAGE_BROKER_RELAY_DOWN"));
                                log.debug("[Broker Guard] Evicted active session: {}", session.getId());
                            }
                        } catch (Exception e) {
                            log.warn("[Broker Guard] Failed to close session: {} - Error: {}", session.getId(), e.getMessage());
                        }
                    }
                });
            }
        } else {
            log.info("💚 [Broker Guard] RabbitMQ broker is online and fully responsive.");
        }
    }
}
