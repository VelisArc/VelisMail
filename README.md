# VelisMail

VelisMail now uses a clean split deployment:

- `frontend/` deploys to Cloudflare Pages
- the Rust backend in `services/` deploys to a Linux VM with Docker Compose

## Env files you need

- Backend template: [`.env.example`](/c:/Users/Mangal/Downloads/VelisMail/.env.example)
- Frontend template: [`frontend/.env.example`](/c:/Users/Mangal/Downloads/VelisMail/frontend/.env.example)
- Local backend file: [`.env`](/c:/Users/Mangal/Downloads/VelisMail/.env)
- Local frontend file: [`frontend/.env`](/c:/Users/Mangal/Downloads/VelisMail/frontend/.env)

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
5. Make sure your GitHub Actions repo secrets include:
   - `HOST`
   - `SSH_PRIVATE_KEY`
6. Push to `main`, or on the VM run:

```bash
bash deploy-vm.sh up
```

The API gateway will serve the backend on `GATEWAY_PORT`.

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
- `REDIS_PASSWORD`: password for the local VM Redis container.
- `JWT_SECRET`: long random secret for auth tokens.
- `OTP_SIGNING_SECRET`: long random secret for OTP challenge signing.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`: your transactional SMTP provider. For Brevo, use `smtp-relay.brevo.com`, port `587`, and the SMTP credentials from the Brevo SMTP settings page.
- `OTP_FROM_EMAIL`: sender address used for OTP and password-reset mail. This mailbox must be allowed by your SMTP provider.
- `PASSKEY_RELYING_PARTY`: your production frontend domain, for example `velismail.online`.
- `PASSKEY_ORIGIN`: full HTTPS frontend origin, for example `https://velismail.online`.
- `ENCRYPTION_KEY`: base64-encoded 32-byte key for storage-service encryption.
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`: object storage credentials if you want attachments/storage enabled.
- `DKIM_PRIVATE_KEY`, `DKIM_SELECTOR`, `SPF_RECORD`: DNS/mail-auth values if you want DKIM/SPF signing and verification fully enabled.
