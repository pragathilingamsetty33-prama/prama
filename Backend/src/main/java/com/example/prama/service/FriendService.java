package com.example.prama.service;

import com.example.prama.dto.FriendDTO;
import com.example.prama.entity.Friendship;
import com.example.prama.entity.User;
import com.example.prama.repository.FriendshipRepository;
import com.example.prama.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional
public class FriendService {

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;

    public void sendFriendRequest(String senderUsername, String receiverUsername) {
        User sender = userRepository.findByUsername(senderUsername)
                .orElseThrow(() -> new IllegalArgumentException("Sender not found"));
        User receiver = userRepository.findByUsername(receiverUsername)
                .orElseThrow(() -> new IllegalArgumentException("User not found with username: " + receiverUsername));

        if (sender.getId().equals(receiver.getId())) {
            throw new IllegalArgumentException("Cannot send a friend request to yourself");
        }

        friendshipRepository.findFriendshipBetweenUsers(sender, receiver).ifPresent(f -> {
            throw new IllegalArgumentException("Friendship or request already exists");
        });

        Friendship friendship = Friendship.builder()
                .sender(sender)
                .receiver(receiver)
                .status(Friendship.Status.PENDING)
                .build();

        friendshipRepository.save(friendship);
    }

    public void acceptFriendRequest(String username, UUID requestId) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        Friendship request = friendshipRepository.findById(requestId)
                .orElseThrow(() -> new IllegalArgumentException("Request not found"));

        if (!request.getReceiver().getId().equals(user.getId())) {
            throw new IllegalArgumentException("Not authorized to accept this request");
        }

        request.setStatus(Friendship.Status.ACCEPTED);
        friendshipRepository.save(request);
    }

    public List<FriendDTO> getPendingRequests(String username) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        return friendshipRepository.findPendingRequestsForUser(user).stream()
                .map(f -> FriendDTO.builder()
                        .id(f.getId())
                        .userId(f.getSender().getId())
                        .username(f.getSender().getUsername())
                        .email(f.getSender().getEmail())
                        .avatar(f.getSender().getAvatar())
                        .build())
                .collect(Collectors.toList());
    }

    public List<FriendDTO> getFriends(String username) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        return friendshipRepository.findAcceptedFriendsForUser(user).stream()
                .map(f -> {
                    User friend = f.getSender().getId().equals(user.getId()) ? f.getReceiver() : f.getSender();
                    return FriendDTO.builder()
                            .id(f.getId())
                            .userId(friend.getId())
                            .username(friend.getUsername())
                            .email(friend.getEmail())
                            .alias(f.getSender().getId().equals(user.getId()) ? f.getReceiverAlias() : f.getSenderAlias())
                            .avatar(friend.getAvatar())
                            .build();
                })
                .collect(Collectors.toList());
    }
}
