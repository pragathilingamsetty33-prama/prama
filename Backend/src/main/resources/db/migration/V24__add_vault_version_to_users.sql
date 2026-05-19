-- V24: Append vault_version to prama_users with zero-downtime default fallback
ALTER TABLE prama_users ADD COLUMN vault_version INTEGER DEFAULT 1 NOT NULL;
