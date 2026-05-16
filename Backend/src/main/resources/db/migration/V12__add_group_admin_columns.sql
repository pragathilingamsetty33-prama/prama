-- Add members_can_add setting to groups
ALTER TABLE groups ADD COLUMN members_can_add BOOLEAN NOT NULL DEFAULT FALSE;

-- Add admin flag and join timestamp to group_members
-- Note: joined_at is already in V11, but let's ensure it's there and add is_admin
ALTER TABLE group_members ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- If V11 didn't have joined_at as a timestamp, we'd add it here, 
-- but it was defined as: joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
-- Let's update the group_roster_keys view to include these new columns
DROP VIEW IF EXISTS group_roster_keys;
CREATE VIEW group_roster_keys AS
SELECT 
    gm.group_id, 
    gm.user_id, 
    gm.is_admin,
    gm.joined_at,
    u.username, 
    upk.public_key
FROM 
    group_members gm
JOIN 
    prama_users u ON gm.user_id = u.id
JOIN 
    user_public_keys upk ON gm.user_id = upk.user_id;

-- Add a table for group messages if it doesn't exist to support history
CREATE TABLE group_messages (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    sender_id UUID NOT NULL,
    encrypted_message TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_msg_group FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
    CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES prama_users(id)
);

-- Table to store the N-wrapped keys for group messages
CREATE TABLE group_message_keys (
    message_id UUID NOT NULL,
    recipient_id UUID NOT NULL,
    wrapped_key TEXT NOT NULL,
    PRIMARY KEY (message_id, recipient_id),
    CONSTRAINT fk_key_msg FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_key_recipient FOREIGN KEY (recipient_id) REFERENCES prama_users(id)
);
