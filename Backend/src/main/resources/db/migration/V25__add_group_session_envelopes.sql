CREATE TABLE group_session_envelopes (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL,
    sender_id VARCHAR(36) NOT NULL,
    sender_session_id VARCHAR(36) NOT NULL,
    recipient_id VARCHAR(36) NOT NULL,
    identity_key_version INTEGER NOT NULL,
    encrypted_payload BYTEA NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_recipient_lookup ON group_session_envelopes (group_id, recipient_id, is_active);
CREATE INDEX idx_sender_invalidation ON group_session_envelopes (group_id, sender_id, is_active);
