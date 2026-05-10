# Changelog

## v3.5.1 - Production hardening release

### Added
- Release metadata across Rust services and frontend package manifests.
- Versioned health responses for API gateway, auth, tenant, mail, storage, and delivery services.
- Auth session persistence with session listing, single-session revoke, and revoke-other-sessions support.
- Account lock enforcement for repeated failed password logins.
- Storage upload request body limit enforcement at the route layer.
- Encrypted S3-compatible storage upload/download with Postgres object metadata and quota reporting.
- Release checklist and operational verification documentation.

### Changed
- Fake production success responses for incomplete storage upload, delivery queue, queue status, and reputation endpoints now fail closed with `501 Not Implemented`.
- `.env.example` now uses production-shaped placeholders and live-key naming.
- External API crate repository/version metadata now points to the VelisMail repository.

### Security
- Exposed GitHub tokens must be revoked before this release is pushed.
- Failed login attempts are recorded and cleared only after successful authentication.
- Active sessions are no longer reported as an empty placeholder list.

### Known limitations
- Full WebAuthn/passkey cryptographic verification is still disabled and returns `501`.
- Delivery queue persistence must be completed before enabling queue operations.
