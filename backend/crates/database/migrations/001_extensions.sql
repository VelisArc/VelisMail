-- Migration 001: Shared PostgreSQL extensions
--
-- VelisMail runs every backend service against a single PostgreSQL database.
-- These extensions provide UUID generation and cryptographic helpers used by
-- the auth, mail, storage, tenant and delivery schemas.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
