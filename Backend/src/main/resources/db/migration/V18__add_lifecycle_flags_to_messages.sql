-- Upgrade private message table schema
ALTER TABLE messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN is_edited BOOLEAN DEFAULT FALSE;

-- Upgrade group message table schema
ALTER TABLE group_messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE group_messages ADD COLUMN is_edited BOOLEAN DEFAULT FALSE;
