-- Add last_read_at to group_members for personal high-water mark read tracking
ALTER TABLE group_members ADD COLUMN last_read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Update group_roster_keys view to include last_read_at
DROP VIEW IF EXISTS group_roster_keys;
CREATE VIEW group_roster_keys AS
SELECT 
    gm.group_id, 
    gm.user_id, 
    gm.is_admin,
    gm.joined_at,
    gm.last_read_at,
    u.username, 
    u.public_key as "publicKey"
FROM 
    group_members gm
JOIN 
    prama_users u ON gm.user_id = u.id;