# Prama – End‑to‑End Encrypted Collaboration Platform

> **Enterprise‑Grade Web Collaboration & End‑to‑End Encrypted Session Management Platform**

---

## 📖 Overview

Prama is a fully functional, zero‑knowledge, end‑to‑end encrypted (E2EE) web application designed for high‑security project discussions, mentorship session management, and real‑time collaboration.  All communication payloads are encrypted in the browser; the server only routes encrypted bytes via STOMP over WebSockets.

---

## 🏗️ System Architecture & Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React.js (Client‑Side Rendering), WebCrypto API, StompJS |
| **Backend** | Java 17+, Spring Boot 3.x |
| **Database** | PostgreSQL (stores encrypted payloads only) |
| **Message Broker** | RabbitMQ with the `stomp` plugin (port 61613) |
| **Deployment** | Azure App Service / Docker / AWS (any container‑ready host) |

---

## ✨ Core Enterprise Features

- **True Zero‑Knowledge E2EE** – AES‑256 encrypts message payloads; each user has an RSA‑2048 key pair generated in the browser. The server never sees plaintext.
- **Deterministic Cryptography** – Strict DER‑ASN.1 binary hashing guarantees exact public‑key fingerprint matching.
- **Fault‑Tolerant WebSocket Eviction** – Asynchronous batched eviction guard prevents thread starvation and `RejectedExecutionException` when the broker drops connections.
- **Polymorphic Security Vault** – Secure client‑side key backup/recovery with master‑password or SSO‑based reset flows.
- **JWT Channel Interception** – Spring interceptors validate JWTs on inbound `SEND`/`SUBSCRIBE` frames, securing long‑lived TCP sockets.

---

## 🛠️ Local Setup & Deployment

### Prerequisites
- Java 17+ and Maven
- Node.js v16+ (npm or yarn)
- PostgreSQL (default port 5432)
- RabbitMQ with the `stomp` plugin enabled (default port 61613)

### 1️⃣ Environment Configuration
> Sensitive credentials are **not** version‑controlled. Use the provided example files.

```bash
# Backend
cp Backend/.env.example Backend/.env   # edit with your DB & RabbitMQ creds

# Frontend
cp FrontendWeb/.env.example FrontendWeb/.env   # set API and WS endpoints, e.g.
#   REACT_APP_API_URL=http://localhost:8080/api
#   REACT_APP_WS_URL=ws://localhost:8080/ws
```

### 2️⃣ Backend Initialization (Spring Boot)
```bash
cd Backend
# Install dependencies & build the JAR
mvn clean install
# Run the application (defaults to port 8080)
./mvnw spring-boot:run
```
The backend will automatically run Flyway migrations, including the demo‑user migration `V2__Add_demo_users.sql`.

### 3️⃣ Frontend Initialization (React)
```bash
cd FrontendWeb
npm install        # or `yarn`
npm run dev         # Vite dev server on http://localhost:5173
```
The frontend connects to the backend WebSocket endpoint defined in `.env`.

### 4️⃣ RabbitMQ & PostgreSQL
- Ensure PostgreSQL is running and a database (e.g. `prama_db`) exists. The credentials in `Backend/.env` must match.
- Start RabbitMQ and enable the STOMP plugin:
```bash
rabbitmq-plugins enable rabbitmq_stomp
```

### 5️⃣ Production Build & Deployment (Azure example)
```bash
# Build the frontend
cd FrontendWeb
npm run build
# Package the backend JAR (already built in step 2)
# Deploy using Azure CLI, Docker, or your preferred method.
```
A ready‑to‑use Azure deployment script (`deploy.ps1`) is included in the repository.

---

## 📂 Repository Layout
```
prama/
├─ Backend/               # Spring Boot API & security layer
│   ├─ src/
│   └─ .env.example
├─ FrontendWeb/           # React + Vite client
│   ├─ src/
│   └─ .env.example
├─ deploy.ps1              # Azure deployment script (fixed)
├─ .gitignore
├─ README.md               # ← **this file**
└─ ...
```

---

## 🛡️ Security & Compliance
- All cryptographic operations are performed in the browser via the Web Crypto API.
- Private keys never leave the client; only encrypted payloads and public keys are stored on the server.
- Passwords are hashed with BCrypt (strength 10) before being stored.
- Flyway ensures schema migrations are versioned and repeatable.

---

## 🤝 Contributing
Feel free to open issues or submit pull requests. Please adhere to the following:
- Keep `.env.example` up‑to‑date.
- Add migration scripts via Flyway (`src/main/resources/db/migration`).
- Write unit tests for new backend features.
- Follow the existing React component style guidelines.

---

---

## Working


## 📜 License
This project is licensed under the **MIT License** – see `LICENSE` for details.
