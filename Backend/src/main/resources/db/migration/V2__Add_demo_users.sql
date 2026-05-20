/*
   Flyway migration to insert demo user accounts.
   Adjust password hashes as needed. The passwords are stored using BCrypt.
*/

-- V2__Add_demo_users.sql

INSERT INTO prama_users (
    id,
    email,
    username,
    password,
    role,
    enabled,
    created_at,
    updated_at
) VALUES
    (
        gen_random_uuid(),
        'alice@demo.com',
        'alice',
        '$2a$10$7W6Y9hG2bKj5sVZbYcPZQO5vZ6Qh1M1Yx9zB2KcXcW9aY8fQeZp3e', -- BCrypt hash for Demo123!
        'ROLE_USER',
        true,
        now(),
        now()
    ),
    (
        gen_random_uuid(),
        'bob@demo.com',
        'bob',
        '$2a$10$7W6Y9hG2bKj5sVZbYcPZQO5vZ6Qh1M1Yx9zB2KcXcW9aY8fQeZp3e', -- BCrypt hash for Demo123!
        'ROLE_USER',
        true,
        now(),
        now()
    );
