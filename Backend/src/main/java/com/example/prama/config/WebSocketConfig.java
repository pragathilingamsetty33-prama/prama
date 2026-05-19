package com.example.prama.config;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final JwtChannelInterceptor jwtChannelInterceptor;
    private final com.example.prama.security.WebSocketSessionHolder webSocketSessionHolder;
    private final WebSocketSubscriptionInterceptor webSocketSubscriptionInterceptor;

    @Value("${spring.rabbitmq.host:localhost}")
    private String rabbitHost;

    @Value("${spring.rabbitmq.username:guest}")
    private String rabbitUser;

    @Value("${spring.rabbitmq.password:guest}")
    private String rabbitPass;

    @Value("${spring.rabbitmq.virtual-host:/}")
    private String rabbitVirtualHost;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // 🚀 THE MODERN STANDARD: A single, unified pure WebSocket endpoint for all clients
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // Upgrade from SimpleBroker to StompBrokerRelay for RabbitMQ
        registry.enableStompBrokerRelay("/topic", "/queue")
                .setRelayHost(rabbitHost)
                .setRelayPort(61613) // Default STOMP port for RabbitMQ
                .setClientLogin(rabbitUser)
                .setClientPasscode(rabbitPass)
                .setSystemLogin(rabbitUser)
                .setSystemPasscode(rabbitPass)
                .setSystemHeartbeatSendInterval(10000)
                .setSystemHeartbeatReceiveInterval(10000)
                .setVirtualHost(rabbitVirtualHost);

        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(jwtChannelInterceptor, webSocketSubscriptionInterceptor);
    }

    @Override
    public void configureWebSocketTransport(
            org.springframework.web.socket.config.annotation.WebSocketTransportRegistration registration) {
        registration.setMessageSizeLimit(256 * 1024); // 256KB for encrypted packets
        registration.setSendBufferSizeLimit(1024 * 1024);
        registration.setSendTimeLimit(20000);

        registration.addDecoratorFactory(handler -> new org.springframework.web.socket.handler.WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(org.springframework.web.socket.WebSocketSession session) throws Exception {
                webSocketSessionHolder.register(session);
                super.afterConnectionEstablished(session);
            }

            @Override
            public void afterConnectionClosed(org.springframework.web.socket.WebSocketSession session, org.springframework.web.socket.CloseStatus closeStatus) throws Exception {
                webSocketSessionHolder.remove(session.getId());
                super.afterConnectionClosed(session, closeStatus);
            }
        });
    }

}
