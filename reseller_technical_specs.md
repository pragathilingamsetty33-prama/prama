# Reseller Technical Specification Document
**Application:** Prama Secure Messaging System (White-Label Ready)
**Version:** 1.0.0-RELEASE
**Target Audience:** CTO, Technical Lead, Enterprise IT Infrastructure Team

---

## 1. Executive Summary & Business Value

The Prama Secure Messaging System is a production-grade, end-to-end encrypted (E2EE) real-time communication platform designed to provide uncompromising data privacy and seamless multi-device synchronization. For an enterprise IT agency, acquiring an Unlimited Reseller License presents a massive opportunity to offer a fully white-labeled, high-security internal communication tool to security-conscious clients (e.g., healthcare, finance, legal, and government sectors).

By bypassing reliance on third-party SaaS providers, your agency can deploy a sovereign messaging infrastructure on your clients' on-premise or private cloud environments. The architecture is engineered to guarantee zero-knowledge server compliance; the backend application and database never possess the cryptographic keys required to read message contents or multimedia attachments.

---

## 2. Technology Stack

The application relies on a modern, robust, and horizontally scalable technology stack spanning mobile, web, and backend environments:

### 2.1 Backend Infrastructure
*   **Core Framework:** Spring Boot 3.5.x (Java 21)
*   **Real-Time Engine:** Spring WebSockets with STOMP protocol (with SockJS fallback).
*   **Security & Authentication:** Spring Security with stateless JWT (JSON Web Token) authentication and rate-limiting (`Bucket4j`).
*   **Push Notifications:** Firebase Admin SDK (FCM) integration for real-time mobile and web push alerts.
*   **Database Migrations:** Flyway.

### 2.2 Database Layer
*   **Primary Datastore:** PostgreSQL.
*   **ORM:** Spring Data JPA / Hibernate.
*   *Note:* The database strictly stores encrypted ciphertexts (`encrypted_content`, `encrypted_aes_key`) and Base64-encoded encrypted key bundles.

### 2.3 Frontend Web
*   **Framework:** React 19 driven by Vite.
*   **State & Routing:** React Router DOM v7.
*   **Cryptography:** 
    *   `node-forge` (v1.4) for RSA-OAEP and AES-GCM encryption.
    *   `hash-wasm` for hardware-accelerated Argon2id key derivation.
*   **Real-Time Client:** `@stomp/stompjs` + `sockjs-client`.

### 2.4 Frontend Mobile (Cross-Platform)
*   **Framework:** React Native 0.81 running on Expo 54 (Development Build).
*   **Routing:** Expo Router.
*   **Native Cryptography:** Native C++ implementations of Argon2id (`react-native-argon2`) ensuring fast key derivation on mobile processors.

---

## 3. Application Workflow (Normal Process)

The core user journey ensures that cryptographic key exchanges happen transparently while maintaining seamless usability.

1.  **User Authentication (Login):**
    *   The user submits their credentials (Username/Password).
    *   The Spring Boot backend verifies the password hash (BCrypt) and issues a short-lived JWT.
2.  **Cryptographic Bootstrap (Device Sync):**
    *   Upon successful login, the client retrieves the user's `encryptedKeyBundle` from the backend.
    *   The client uses the user's plaintext password to derive a 256-bit symmetric key locally using **Argon2id**.
    *   This derived key decrypts the bundle via **AES-GCM**, extracting the user's private and public RSA keys into memory. *The plaintext password and private keys never leave the device.*
3.  **Real-Time Connection:**
    *   The client establishes a secure WebSocket connection over `/ws`.
    *   A custom `JwtChannelInterceptor` validates the JWT on the initial STOMP `CONNECT` frame.
    *   The client subscribes to their private topic queue (`/user/topic/messages`) to listen for incoming data.
4.  **Sending a Message:**
    *   When the user types a message, the client generates a one-time random 256-bit AES key.
    *   The message plaintext is encrypted using **AES-GCM** with the random key.
    *   The one-time AES key is then encrypted twice using **RSA-OAEP**: once with the *recipient's* public key (`encryptedAesKey`) and once with the *sender's* public key (`senderEncryptedAesKey`).
    *   The resulting ciphertexts are transmitted to the backend over the `/app/chat` STOMP destination and persisted to PostgreSQL.

---

## 4. Security Architecture & Deep Dive (E2EE Messaging)

Prama's zero-knowledge architecture relies on a Hybrid Cryptosystem (RSA + AES) combined with robust Key Derivation Functions (KDF) to achieve maximum security without sacrificing performance.

### 4.1 Hybrid Encryption Flow
*   **Symmetric Encryption (AES-GCM):** Large data payloads (message strings, image/video buffers up to 50MB) are encrypted symmetrically. `node-forge` generates a random 12-byte IV for every message. AES-GCM provides authenticated encryption, meaning the authentication `tag` ensures the ciphertext cannot be tampered with in transit or at rest.
*   **Asymmetric Key Wrapping (RSA-OAEP):** A 2048-bit RSA keypair is generated entirely on the client side during registration. The AES key used for payload encryption is "wrapped" (encrypted) using RSA-OAEP with SHA-256 and MGF1-SHA1 padding.

### 4.2 Cross-Device Key Synchronization
To solve the UX problem of E2EE (where losing a device means losing chat history), Prama implements a secure Key Bundle Sync:
*   During signup, the client derives a Master Key from the user's password using **Argon2id** (Parameters: 4 iterations, 64MB memory, parallelism of 2).
*   The generated RSA Private Key is encrypted with this Master Key using AES-GCM.
*   This encrypted blob (`encryptedKeyBundle`) is stored in PostgreSQL. When the user logs in on a new phone or browser, the device pulls the bundle, repeats the Argon2id derivation locally, and decrypts their RSA Private Key.

### 4.3 Web-Push Notifications (Firebase Integration)
*   Because the backend cannot read message contents, Push Notifications are handled specifically.
*   The client registers a Firebase Cloud Messaging (`fcmToken`) which is tied to the `User` entity.
*   When a message arrives, the backend triggers the `Firebase Admin SDK` to send a generic notification ("You have a new secure message") to the recipient device, prompting the OS to wake the app, pull the encrypted payload over the WebSocket/REST layer, and decrypt it locally for display.

---

## 5. Deployment & Infrastructure

To deploy this sovereign messaging stack within an enterprise environment, the IT infrastructure team should provision the following:

### 5.1 Environment Requirements
*   **Compute:** Minimum 2x Linux VM instances (e.g., Ubuntu 22.04 / RHEL 9) to run the Spring Boot JVM. 4 vCPUs, 8GB RAM recommended per node for optimal Argon2/crypto background processing and WebSocket connection holding.
*   **Database:** PostgreSQL 15+ cluster (Primary/Replica) with persistent SSD storage. Connection pooling (e.g., PgBouncer or HikariCP default) is required.
*   **Reverse Proxy / Load Balancer:** Nginx or HAProxy.
    *   **Crucial:** The proxy *must* be configured to support WebSocket upgrades (`Connection: Upgrade`, `Upgrade: websocket`) with prolonged timeouts (e.g., `proxy_read_timeout 3600s;`).
    *   TLS 1.3 termination should occur at the proxy layer.

### 5.2 Network & Security Configuration
*   **Ports:** TCP 80/443 (Frontend & Proxy), TCP 8080 (Internal API/WS), TCP 5432 (Postgres).
*   **CORS:** The Spring Boot `SecurityConfig` provides a `CorsConfigurationSource`. In production, wildcard allowed origins (`*`) must be tightly restricted to the specific domains hosting the Web Application.
*   **FCM Credentials:** The backend requires a Firebase Service Account JSON key provisioned within the deployment environment to enable mobile wake-ups and notifications.

### 5.3 Scaling Considerations
The stateless JWT architecture allows the REST API to scale horizontally out of the box. For WebSocket scaling (when deploying >1 Spring Boot nodes), the `MessageBrokerRegistry` in `WebSocketConfig.java` must be updated to route STOMP messages through an external message broker (like RabbitMQ or Redis) rather than the default `SimpleBroker` to ensure cross-node message delivery.
