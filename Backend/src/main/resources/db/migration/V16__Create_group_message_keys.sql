-- Migration to create the group message keys join table for E2EE persistence
DROP TABLE IF EXISTS group_message_keys;

CREATE TABLE group_message_keys (
    message_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    encrypted_key VARCHAR(1000) NOT NULL,
    PRIMARY KEY (message_id, user_id),
    CONSTRAINT fk_key_msg FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE
);
