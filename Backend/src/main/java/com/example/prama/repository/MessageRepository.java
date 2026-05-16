package com.example.prama.repository;

import com.example.prama.entity.Message;
import com.example.prama.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface MessageRepository extends JpaRepository<Message, UUID> {

    @Query("SELECT m FROM Message m WHERE " +
           "(m.sender = :u1 AND m.recipient = :u2) OR " +
           "(m.sender = :u2 AND m.recipient = :u1) " +
           "ORDER BY m.timestamp ASC")
    List<Message> findConversation(@Param("u1") User u1, @Param("u2") User u2);
    
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.transaction.annotation.Transactional
    @Query("UPDATE Message m SET m.status = 'READ' WHERE m.sender.id = :friendId AND m.recipient.id = :myId AND m.status <> 'READ'")
    void markAsRead(@Param("friendId") UUID friendId, @Param("myId") UUID myId);
}
