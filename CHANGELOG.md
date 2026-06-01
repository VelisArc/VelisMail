# Changelog

## v4.0.2 - Mailbox Routing & Platform Admin Control

### Added
- **Mailbox-specific inbox routing**: Business mailbox rows now open a filtered inbox for that exact address instead of only opening details.
- **Platform Admin bootstrap**: First admin or explicitly configured platform admins can access the admin console without being hardcoded to one mailbox domain.
- **Admin command center**: Added user, plan, role, status, risk, mailbox, and storage controls in a single scannable admin panel.

### Fixed
- **Internal business mail delivery**: Same-domain mailbox recipients now get persisted inbox copies, with DB sync failures surfaced instead of silently falling back to local-only storage.
- **Mailbox sender validation**: Internal mail to uncreated local addresses is rejected before delivery so messages do not disappear into an unmanaged address.
- **Dashboard viewport sizing**: Business dashboard height now uses the actual viewport to avoid extra mobile whitespace.

---

## v4.0.1 - Design System Harmony & Session UX Hardening

### Added
- **Landing Page Ecosystem**: Dynamic active session checking inside the main header/navbar, routing authenticated users straight to the correct setup or main business workspace dashboard.
- **Pricing Card Action Links**: Dynamic routing for paid tier CTA plan buttons. Fully session-aware redirection directly into workspace dashboards, bypassing redundant login links.
- **About Page Redesign**: Premium "Core Operating Pillars" section featuring high-fidelity responsive cards and specific Lucide styling icons (`Shield`, `Lock`, `Award`).

### Fixed
- **Visual styling mismatches**: Promoted primary navigation (`.home-nav`) and footer (`.home-footer`) styling globally into `index.css` to enable 100% layout and interactive transition consistency.
- **Unused imports compilation errors**: Removed unused `ArrowLeft` and `Shield` icons in `Pricing.tsx` to fix TypeScript compiler and ESLint CI errors.
- **Missing Gradient Text Styling**: Defined the missing `.gradient-text` styling token globally in the CSS design system.

---

## v4.0.0 - Industry-Standard Production Upgrade

### Added
- **Mail Service**: Complete `send_email()` with HTML multipart (text + HTML via RFC 5322), CC/BCC support, threading (In-Reply-To, References, Message-ID), and platform DB storage.
- **Mail Service**: 7 new endpoints — `GET/PATCH/DELETE /emails/:id`, `POST /emails/:id/move`, `GET /threads/:id`, `GET /folders`, `POST /search`.
- **Mail Service**: Platform emails migration with full-text search indexes.
- **Delivery Engine**: DKIM signing & verification using ED25519 via ring with relaxed/relaxed canonicalization (RFC 6376).
- **Delivery Engine**: SPF record parsing and IP authorization checking with CIDR matching (RFC 7208).
- **Delivery Engine**: DMARC policy evaluation with strict/relaxed alignment (RFC 7489).
- **Delivery Engine**: Postgres-backed delivery queue with status lifecycle (pending → processing → delivered / failed / dead_letter), priority ordering, and exponential backoff retry.
- **Delivery Engine**: Bounce handling with hard/soft classification via SMTP enhanced status codes (RFC 3463), automatic suppression list, and domain-level bounce rate statistics.
- **Delivery Engine**: Deliverability score endpoint combining DKIM/SPF/DMARC config status and bounce rate.
- **Delivery Engine**: Background queue worker polling every 5 seconds with per-item async processing.
- **Storage Service**: Multipart form upload endpoint (`POST /upload/multipart`).
- **Storage Service**: File listing with pagination (`GET /list`).
- **Storage Service**: File metadata endpoint (`GET /metadata/*key`).
- **API Gateway**: Content-Security-Policy (CSP) header restricting resource origins.
- **API Gateway**: HTTP Strict Transport Security (HSTS) header with 1-year max-age and preload.
- **API Gateway**: Optional Postgres persistence for team invites and inbound routes (previously in-memory only).
- **API Gateway**: Gateway persistence migration (team_invites + inbound_routes tables).
- **All Services**: Graceful shutdown via `Ctrl+C` / `SIGTERM` signal handlers with clean connection pool drain.
- **All Services**: Structured startup banners with service name, version, and bind address.
- **All Services**: Deep health checks using `velismail_common::HealthResponse` with live DB/Redis/S3 connectivity verification.
- **Workspace**: OpenAPI dependencies (`utoipa`, `utoipa-swagger-ui`) added to workspace and API gateway.

### Changed
- **Workspace**: Version bumped from 3.5.1 to 4.0.0.
- **Workspace**: Centralized all dependency versions in workspace Cargo.toml — individual services now use workspace references instead of inline versions.
- **Workspace**: Added `multipart` feature to axum, `timeout` feature to tower-http.
- **Workspace**: Release profile optimized with `opt-level = "s"` for smaller binaries.
- **Mail Service**: `send_email()` rewritten from stub to production-grade SMTP delivery with structured error handling.
- **Mail Service**: Business email pool upgraded with LRU eviction at 50 connections and health-check-before-reuse.
- **Mail Service**: All `row.try_get::<T, _>(0)` positional index access replaced with named column access (`row.try_get("column_name")`).
- **Storage Service**: `get_quota()` reads from `DEFAULT_QUOTA_BYTES` environment variable instead of hardcoded 5GB value.
- **API Gateway**: `AppState` now includes optional `PgPool` for persistence, with graceful fallback to in-memory when `DATABASE_URL` is not set.

### Security
- **API Gateway**: Added `Content-Security-Policy` header blocking inline scripts, restricting resource origins.
- **API Gateway**: Added `Strict-Transport-Security` header enforcing HTTPS with 1-year max-age, includeSubDomains, and preload.
- **Delivery Engine**: Bounce suppression list prevents sending to addresses that have hard-bounced.

### Known Limitations
- Full WebAuthn/passkey cryptographic verification is still disabled and returns `501`.
- API Gateway routes.rs is still a monolith (3,800+ lines) — modular split deferred to v4.1.
- Delivery queue worker currently marks items as delivered (SMTP integration placeholder for production).
- SPF `a`, `mx`, and `include` mechanisms require async DNS resolution (not yet implemented).

---

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
