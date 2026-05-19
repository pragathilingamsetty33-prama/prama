package com.example.prama.repository;

import com.example.prama.entity.GroupSessionEnvelope;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

public interface GroupSessionEnvelopeRepository extends JpaRepository<GroupSessionEnvelope, String> {

    @Modifying
    @Transactional
    @Query("UPDATE GroupSessionEnvelope g SET g.isActive = false WHERE g.groupId = :groupId AND g.senderId = :senderId AND g.isActive = true")
    void invalidateLegacyEnvelopes(String groupId, String senderId);
}
