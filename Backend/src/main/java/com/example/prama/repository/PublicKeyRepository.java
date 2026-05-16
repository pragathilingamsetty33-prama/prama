package com.example.prama.repository;

import com.example.prama.entity.UserPublicKey;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PublicKeyRepository extends JpaRepository<UserPublicKey, java.util.UUID> {
}
