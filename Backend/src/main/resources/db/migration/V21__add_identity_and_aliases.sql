-- 📊 PHASE 8: Schema Update for Personal Identity & Aliasing
ALTER TABLE prama_users ADD COLUMN avatar TEXT;
ALTER TABLE friendships ADD COLUMN sender_alias VARCHAR(255);
ALTER TABLE friendships ADD COLUMN receiver_alias VARCHAR(255);
