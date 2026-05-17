-- ========================================================
-- 📊 PHASE 11: ROOT ADMINISTRATIVE CONTROL PLANE SEEDING
-- ========================================================
INSERT INTO prama_users (id, username, email, password, role, enabled) 
VALUES (
    gen_random_uuid(),
    '${admin.username}', 
    '${admin.email}', 
    '${admin.password.hash}', 
    'ADMIN', 
    true
)
ON CONFLICT (username) DO NOTHING;