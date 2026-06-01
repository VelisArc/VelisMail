# VelisMail

Current release: **v4.0.3**

VelisMail now uses a clean split deployment:

- `frontend/` deploys to Cloudflare Pages
- the Rust backend in `services/` deploys to a Linux VM with Docker Compose

## Env files you need

- Backend template: [`.env.example`](.env.example)
- Frontend template: [`frontend/.env.example`](frontend/.env.example)
- Local backend file: `.env` (not committed)
- Local frontend file: `frontend/.env` (not committed)

Only these two env files are required now.

Important:

- Do not commit `.env` or `frontend/.env`.
- `frontend/.env` should only contain `VITE_API_URL=https://your-api-domain`.
- OTP and password-reset mail uses the backend SMTP credentials from `.env`.
- Live BYO mail-provider validation and direct outbound delivery currently supports `sendgrid`, `resend`, `postmark`, `brevo`, and `custom_webhook`.

## Backend deploy

1. Copy `.env.example` to `.env`.
2. Fill the required values in `.env`.
3. On your Linux VM, place that `.env` inside `~/VelisMail/.env`.
4. Make sure Docker and Docker Compose v2 are installed on the VM.
5. Make sure ports `80` and `443` are open on the VM security group / firewall.
6. `api.velismail.online` must point to the VM public IP.
7. This repo now uses `Caddy` in Docker Compose to terminate TLS and reverse-proxy `https://api.velismail.online` to the internal `api-gateway:3000`.
8. Make sure your GitHub Actions repo secrets include:
   - `HOST`
   - `SSH_PRIVATE_KEY`
9. Push to `main`, or on the VM run:

```bash
bash deploy-vm.sh up
```

After deploy, these should work:

```bash
curl http://127.0.0.1:3000/health
curl https://api.velismail.online/health
```

The health response includes the running service version. A production v4.0.3
deploy should report `"version":"4.0.3"` on all Rust services.

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

## CI/CD

- `.github/workflows/ci.yml` checks backend and frontend builds.
- `.github/workflows/deploy-vm.yml` deploys the VM backend.
- `.github/workflows/deploy-cloudflare.yml` deploys Cloudflare Pages.

## Required backend keys

- `POSTGRES_PASSWORD`: password for the local VM Postgres container.
- `AUTH_POSTGRES_DB`, `MAIL_POSTGRES_DB`, `STORAGE_POSTGRES_DB`, `TENANT_POSTGRES_DB`, `DELIVERY_POSTGRES_DB`: optional per-service database names. Defaults are already wired for isolated service migrations and are recommended over one shared database.
- `REDIS_PASSWORD`: password for the local VM Redis container.
- `FRONTEND_URL`: your public frontend URL (e.g. `https://velismail.online`). Critical for restrictive CORS on the API Gateway.
- `JWT_SECRET`: long random secret for auth tokens. Required by both Auth Service and API Gateway.
- `OTP_SIGNING_SECRET`: long random secret for OTP challenge signing.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`: your transactional SMTP provider. For Brevo, use `smtp-relay.brevo.com`, port `587`, and the SMTP credentials from the Brevo SMTP settings page.
- `OTP_FROM_EMAIL`: sender address used for OTP and password-reset mail. This mailbox must be allowed by your SMTP provider.
- `ENCRYPTION_KEY`: base64-encoded 32-byte key for storage-service encryption.
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`: object storage credentials if you want attachments/storage enabled.
- `DKIM_PRIVATE_KEY`, `DKIM_SELECTOR`, `SPF_RECORD`: DNS/mail-auth values if you want DKIM/SPF signing and verification fully enabled.

## DKIM public key placement

`dkim-public.pem` does not go into this repository, Kubernetes manifests, or `.env`.

Use it like this:

1. Keep `dkim-private.pem` on the machine where you generated it.
2. Put the private key contents into `DKIM_PRIVATE_KEY` in backend `.env`.
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
