package com.example.prama.repository;

import com.example.prama.entity.Friendship;
import com.example.prama.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface FriendshipRepository extends JpaRepository<Friendship, UUID> {

    @Query("SELECT f FROM Friendship f WHERE f.receiver = :user AND f.status = 'PENDING'")
    List<Friendship> findPendingRequestsForUser(User user);

    @Query("SELECT f FROM Friendship f WHERE (f.sender = :user OR f.receiver = :user) AND f.status = 'ACCEPTED'")
    List<Friendship> findAcceptedFriendsForUser(User user);

    @Query("SELECT f FROM Friendship f WHERE (f.sender = :user1 AND f.receiver = :user2) OR (f.sender = :user2 AND f.receiver = :user1)")
    Optional<Friendship> findFriendshipBetweenUsers(User user1, User user2);

    @Query("SELECT f FROM Friendship f WHERE (f.sender.id = :id1 AND f.receiver.id = :id2) OR (f.sender.id = :id2 AND f.receiver.id = :id1)")
    Optional<Friendship> findByUserIds(UUID id1, UUID id2);
}


