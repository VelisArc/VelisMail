-- Initial schema migration
-- Enables shared Postgres extensions used by all VelisMail services.
-- Per-service tables are created by each service at startup (auth, mail, storage, etc.).

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
