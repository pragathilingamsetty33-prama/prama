-- V23__add_recency_sorting_indexes.sql
-- Prevents full table scans when aggregating max timestamps
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp);
CREATE INDEX IF NOT EXISTS idx_group_messages_timestamp ON group_messages (timestamp);
