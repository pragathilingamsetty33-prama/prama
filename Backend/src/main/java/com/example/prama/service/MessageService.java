package com.example.prama.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class MessageService {

    private final JdbcTemplate jdbcTemplate;

    public Map<String, Long> getUnreadSummaries(UUID userId) {
        Map<String, Long> summaries = new HashMap<>();

        // 1. Fetch unread counts for Direct Messages
        String dmSql = "SELECT sender_id, COUNT(*) FROM messages " +
                       "WHERE recipient_id = ?::uuid AND status <> 'READ' " +
                       "GROUP BY sender_id";
        
        jdbcTemplate.query(dmSql, rs -> {
            String senderId = rs.getString("sender_id");
            long count = rs.getLong(2);
            summaries.put(senderId, count);
        }, userId.toString());

        // 2. Fetch unread counts for Group Messages
        String groupSql = "SELECT gm.group_id, COUNT(gm.id) FROM group_messages gm " +
                          "JOIN group_members gmem ON gm.group_id = gmem.group_id " +
                          "WHERE gmem.user_id = ?::uuid " +
                          "  AND gm.sender_id <> ?::uuid " +
                          "  AND gm.timestamp >= gmem.joined_at " +
                          "  AND gm.timestamp > COALESCE(gmem.last_read_at, gmem.joined_at) " +
                          "GROUP BY gm.group_id";

        jdbcTemplate.query(groupSql, rs -> {
            String groupId = rs.getString("group_id");
            long count = rs.getLong(2);
            summaries.put(groupId, count);
        }, userId.toString(), userId.toString());

        return summaries;
    }
}
