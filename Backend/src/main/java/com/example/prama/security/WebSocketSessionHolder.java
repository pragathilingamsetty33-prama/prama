package com.example.prama.security;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class WebSocketSessionHolder {
    private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    public void register(WebSocketSession session) {
        if (session != null && session.getId() != null) {
            sessions.put(session.getId(), session);
        }
    }

    public WebSocketSession get(String sessionId) {
        if (sessionId == null) return null;
        return sessions.get(sessionId);
    }

    public void remove(String sessionId) {
        if (sessionId != null) {
            sessions.remove(sessionId);
        }
    }
}
