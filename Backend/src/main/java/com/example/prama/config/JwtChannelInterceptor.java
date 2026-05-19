package com.example.prama.config;

import com.example.prama.security.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class JwtChannelInterceptor implements ChannelInterceptor {

    private final JwtService jwtService;
    private final UserDetailsService userDetailsService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor != null) {
            StompCommand command = accessor.getCommand();
            if (StompCommand.CONNECT.equals(command)) {
                // When client connects, they must pass the JWT token in the "Authorization" header
                String authHeader = accessor.getFirstNativeHeader("Authorization");

                if (authHeader != null && authHeader.startsWith("Bearer ")) {
                    String token = authHeader.substring(7);
                    try {
                        String userEmail = jwtService.extractUsername(token);
                        
                        if (userEmail != null) {
                            UserDetails userDetails = userDetailsService.loadUserByUsername(userEmail);
                            
                            if (jwtService.isTokenValid(token, userDetails)) {
                                UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                                        userDetails, null, userDetails.getAuthorities()
                                );
                                // Attach the authenticated user to the STOMP session
                                accessor.setUser(authentication);
                                
                                // Save JWT token in session attributes to validate on subsequent commands
                                if (accessor.getSessionAttributes() != null) {
                                    accessor.getSessionAttributes().put("jwt_token", token);
                                }
                            } else {
                                throw new RuntimeException("Invalid WebSocket JWT Token");
                            }
                        }
                    } catch (Exception e) {
                        throw new RuntimeException("Authentication failed for WebSocket connection: " + e.getMessage());
                    }
                } else {
                    throw new RuntimeException("Missing Authorization header for WebSocket connection");
                }
            } else if (StompCommand.SEND.equals(command) || StompCommand.SUBSCRIBE.equals(command)) {
                if (accessor.getSessionAttributes() != null) {
                    String token = (String) accessor.getSessionAttributes().get("jwt_token");
                    if (token != null) {
                        try {
                            String userEmail = jwtService.extractUsername(token);
                            UserDetails userDetails = userDetailsService.loadUserByUsername(userEmail);
                            if (!jwtService.isTokenValid(token, userDetails)) {
                                throw new RuntimeException("Expired or invalid session token");
                            }
                        } catch (Exception e) {
                            throw new RuntimeException("Session authorization validation failed: " + e.getMessage());
                        }
                    } else {
                        throw new RuntimeException("Unauthorized channel frame: Missing session token");
                    }
                }
            }
        }
        return message;
    }
}
