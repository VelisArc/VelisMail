# VelisMail

Current release: **v5.3.0**

VelisMail deploys as:

- `frontend/` deploys to Cloudflare Pages
- **`backend-worker/` is the production backend** — a TypeScript Cloudflare Worker backed by Cloudflare D1 (`velismail-api` / `velismail-db`), serving `https://api.velismail.online`
- `backend/` (Rust) is the legacy backend, kept for self-hosted installs

## Backend deploy (production — Cloudflare Worker + D1)

Production runs entirely inside the Cloudflare account; there is no VM to manage.

```bash
cd backend-worker
npm install
npx wrangler d1 create velismail-db
# paste the returned database_id into wrangler.toml ([[d1_databases]])
npx wrangler d1 execute velismail-db --remote --file=./schema.sql

# Secrets (type the value once prompted — they are encrypted at rest):
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put RESEND_WEBHOOK_SECRET

npx wrangler deploy   # deploys to https://api.velismail.online (custom domain)
```

Service bindings, vars and secrets live in `backend-worker/wrangler.toml`.
Inbound mail is received through Resend's Receiving webhook
(`POST /api/v1/mail/inbound`, verified by the Svix signature derived from
`RESEND_WEBHOOK_SECRET`). The frontend talks to the same API surface it
always did — only the runtime changed.

## Env files you need (legacy — VM self-host only)

Production configuration lives in `backend-worker/wrangler.toml` and Cloudflare
Worker secrets; no `.env` files are needed. The files below are only for the
legacy Rust services.

- Backend template: [`.env.example`](.env.example)
- Frontend template: [`frontend/.env.example`](frontend/.env.example)
- Local backend file: `.env` (not committed)
- Local frontend file: `frontend/.env` (not committed)

Only these two env files are needed to self-host the legacy backend.

Important:

- Do not commit `.env` or `frontend/.env`.
- `frontend/.env` should only contain `VITE_API_URL=https://your-api-domain`.
- Platform email (OTP, password reset, feedback, and the backend relay) uses **Resend** through `PLATFORM_RESEND_API_KEY`. SMTP/Brevo is no longer used.
- Live BYO mail-provider validation and direct outbound delivery supports `sendgrid`, `resend`, `postmark`, `amazonses`, and `custom_webhook`.

## Backend deploy (legacy — Rust VM, self-host only)

The legacy Rust backend deploys as a set of native services. Every service
runs as a sandboxed systemd unit behind Caddy, which terminates TLS and
load-balances across gateway instances. Production does not use this path;
use it only when self-hosting the Rust backend instead of the Worker.

1. Copy `.env.example` to `.env`.
2. Fill the required values in `.env`.
3. Copy the repository to the VM (for example `~/VelisMail`).
4. Make sure ports `80` and `443` are open on the VM security group / firewall.
5. `api.velismail.online` must point to the VM public IP. An Elastic IP is
   recommended so the address survives stop/start; if you skip it, update the
   Cloudflare A record after any stop/start (see `deploy/native/README.md`).
6. Run the installer. It installs PostgreSQL, Caddy, the service account, the
   systemd units and the Caddy reverse proxy, then applies database migrations
   and starts every service:

```bash
sudo bash deploy/native/install.sh
```

The installer validates the env file first (`deploy/native/check-env.sh`) and
refuses to continue on unbalanced quotes, duplicate keys, CRLF corruption or a
weak `POSTGRES_PASSWORD`.

Fast update without recompiling:

```bash
sudo bash deploy/native/deploy-fast.sh
```

Scale the gateway on an existing node:

```bash
sudo NEW_SCALE=2 bash deploy/native/scale.sh
```

After deploy, these should work:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/health/ready
curl -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/metrics
curl https://api.velismail.online/health   # after the DNS A record exists
```

The health response includes the running service version. A production v5.3.0
deploy should report `"version":"5.3.0"` on all Rust services.

### Database migrations
Migrations live in `backend/crates/database/migrations` and are applied by
SQLx at service start. They are versioned and tracked in the
`_sqlx_migrations` table, so they are safe to re-run and safe to run from
multiple services at the same time.

## Frontend deploy

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Set `VITE_API_URL` in `frontend/.env` to your public backend URL.
   Example: `https://api.velismail.online`
3. In GitHub repo secrets, add:
   - `CF_API_TOKEN`
   - `CF_ACCOUNT_ID`
   - `VITE_API_URL`
4. Then deploy:

```bash
cd frontend
npm ci
npm run build
npx wrangler pages deploy dist --project-name velismail
```

## CI

- `.github/workflows/ci.yml` checks backend and frontend builds.
- Backend deploys are manual with `sudo bash deploy/native/install.sh` on the VM.

## Required backend keys

- `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`: local VM PostgreSQL credentials. The password must be 16+ URL-safe characters (letters, digits, `_`, `-`) because it is embedded in `DATABASE_URL`.
- `REDIS_URL`: optional Redis/Upstash URL. Use `rediss://` for Upstash; the services run without Redis if it is unreachable.
- `METRICS_TOKEN`: bearer token required by `/metrics` on the gateway. Leave blank to disable the endpoint.
- `FRONTEND_URL`: your public frontend URL (e.g. `https://velismail.online`). Critical for restrictive CORS on the API Gateway.
- `JWT_SECRET`: long random secret for auth tokens. Required by both Auth Service and API Gateway.
- `OTP_SIGNING_SECRET`: long random secret for OTP challenge signing.
- `PLATFORM_RESEND_API_KEY`: Resend API key used for OTP, password-reset, feedback, and the backend mail relay. No SMTP relay is required.
- `PLATFORM_FROM_EMAIL`, `PLATFORM_FROM_NAME`: sender identity for platform email. The sending domain must be verified in Resend.
- `OTP_FROM_EMAIL`: sender address used for OTP and password-reset mail. Defaults to `PLATFORM_FROM_EMAIL`.
- `ENCRYPTION_KEY`: base64-encoded 32-byte key for storage-service encryption.
- `STORAGE_ROOT`: local directory used by storage-service for encrypted attachments. It must be writable by the service user.
- `DKIM_PRIVATE_KEY`, `DKIM_SELECTOR`, `SPF_RECORD`: DNS/mail-auth values if you want DKIM/SPF signing and verification fully enabled.

## DKIM public key placement

Platform mail for `velismail.online` is DKIM-signed by Resend, which owns that
key. The steps below are only for BYO domains signed by the delivery engine
when `DKIM_PRIVATE_KEY` is configured.

`dkim-public.pem` does not go into this repository or `.env`.

Use it like this:

1. Keep `dkim-private.pem` on the machine where you generated it.
2. Put the private key into `DKIM_PRIVATE_KEY` as a **single line**, replacing
   real newlines with the two characters `\n` (the delivery engine expands them
   at startup). Example:
   `DKIM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMC4...\n-----END PRIVATE KEY-----\n"`
3. Keep `DKIM_SELECTOR=velismail` unless you want a different selector.
4. Publish the public key from `dkim-public.pem` in DNS as a TXT record at:
   `velismail._domainkey.yourdomain.com`
5. In Cloudflare DNS, the record name is:
   `velismail._domainkey`
   if the zone is already `yourdomain.com`.
6. The TXT value should be the DKIM public key record, usually:
   `v=DKIM1; k=rsa; p=...`

Important:

- Do not paste the whole `dkim-public.pem` file with `-----BEGIN PUBLIC KEY-----` into `.env`.
- Do not commit `dkim-private.pem` or `dkim-public.pem` to GitHub.
- The public key belongs in DNS, not in application code.
- Run `sudo bash deploy/native/check-env.sh /etc/velismail/velismail.env`
  after editing the key; an unbalanced quote hides every variable that follows.
