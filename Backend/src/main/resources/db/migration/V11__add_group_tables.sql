CREATE TABLE groups (
    group_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_members (
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT fk_group FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES prama_users(id) ON DELETE CASCADE
);

-- View to fetch group roster with public keys efficiently
CREATE VIEW group_roster_keys AS
SELECT 
    gm.group_id, 
    gm.user_id, 
    u.username, 
    upk.public_key
FROM 
    group_members gm
JOIN 
    prama_users u ON gm.user_id = u.id
JOIN 
    user_public_keys upk ON gm.user_id = upk.user_id;
