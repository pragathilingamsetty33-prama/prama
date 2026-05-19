package com.example.prama.repository;

import com.example.prama.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;
import java.util.List;

@Repository
public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
    Optional<User> findByUsername(String username);
    boolean existsByUsername(String username);
    Optional<User> findByEmailOrUsername(String email, String username);
    List<User> findByUsernameContainingIgnoreCase(String username);

    @Query(value = "SELECT * FROM prama_users ORDER BY id LIMIT :limit", nativeQuery = true)
    List<User> findFirstPage(@Param("limit") int limit);

    @Query(value = "SELECT * FROM prama_users WHERE id > :cursor ORDER BY id LIMIT :limit", nativeQuery = true)
    List<User> findNextPage(@Param("cursor") java.util.UUID cursor, @Param("limit") int limit);
}
