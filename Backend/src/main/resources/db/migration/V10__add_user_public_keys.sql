CREATE TABLE user_public_keys (
    user_id UUID PRIMARY KEY,
    public_key TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_public_key FOREIGN KEY (user_id) REFERENCES prama_users(id) ON DELETE CASCADE
);
