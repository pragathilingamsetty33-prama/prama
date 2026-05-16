package com.example.prama.repository;

import com.example.prama.entity.GroupMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface GroupMessageRepository extends JpaRepository<GroupMessage, UUID> {
}
