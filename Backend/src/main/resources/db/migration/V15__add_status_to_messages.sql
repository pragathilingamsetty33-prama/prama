-- Migration to add status tracking for message receipts (ticks)
-- This is non-destructive and will default existing messages to 'SENT'
ALTER TABLE messages 
ADD COLUMN status VARCHAR(255) NOT NULL DEFAULT 'SENT';

-- Optional: Create an index if you plan to query by status frequently in the future
CREATE INDEX idx_messages_status ON messages(status);
