CREATE TABLE messages (
    id UUID PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES prama_users(id),
    recipient_id UUID NOT NULL REFERENCES prama_users(id),
    encrypted_aes_key TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON messages(sender_id, recipient_id);
