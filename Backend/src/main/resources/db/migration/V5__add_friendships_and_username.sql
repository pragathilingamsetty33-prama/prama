-- Add username to users table
ALTER TABLE prama_users ADD COLUMN username VARCHAR(255);

-- Update existing users to have a username based on their email prefix
UPDATE prama_users SET username = split_part(email, '@', 1) WHERE username IS NULL;

-- Make username not null and unique
ALTER TABLE prama_users ALTER COLUMN username SET NOT NULL;
ALTER TABLE prama_users ADD CONSTRAINT prama_users_username_key UNIQUE (username);

-- Create friendships table
CREATE TABLE friendships (
    id UUID PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES prama_users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES prama_users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE
);
