# Cloudflare Worker Setup Guide

This repo no longer needs Render or container hosting for the backend. The active backend is a single Cloudflare Worker defined by [`worker.js`](worker.js) and [`wrangler.toml`](wrangler.toml).

## What The Worker Handles

- `GET /health`
- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login/zkp`
- `POST /api/v1/auth/login/passkey`
- `POST /api/v1/verify`
- `POST /api/v1/tenants/verify-domain`
- `POST /api/v1/mail/send`

## GitHub Secrets

Add these in GitHub: `Settings -> Secrets and variables -> Actions`

| Secret | Value |
| --- | --- |
| `CF_API_TOKEN` | Cloudflare API token with Worker deploy access |
| `CF_ACCOUNT_ID` | Your Cloudflare account id |
| `BREVO_API_KEY` | Brevo HTTP API key for OTP and mail delivery |
| `BREVO_SENDER_NAME` | Sender name shown in OTP emails |
| `OTP_SIGNING_SECRET` | Long random secret for stateless OTP signing |
| `PRIMARY_MAIL_DOMAIN` | Your sending domain, for example `velismail.online` |
| `MAIL_FROM_EMAIL` | Default app sender, for example `noreply@velismail.online` |
| `MAIL_FROM_NAME` | Default app sender name |
| `OTP_FROM_EMAIL` | OTP sender, for example `verify@velismail.online` |
| `ALLOWED_SENDER_DOMAINS` | Comma-separated verified sender domains |

Optional:

| Variable | Value |
| --- | --- |
| `FRONTEND_ORIGIN` | Your Vercel domain, for example `https://velismail.online` |
| `OTP_TTL_SECONDS` | OTP expiry window in seconds, default `600` |

## Recommended Cloudflare Token Permissions

Create a custom token with:

- `Account -> Workers Scripts -> Edit`
- `Account -> Workers Routes -> Edit`
- `Account -> Account Settings -> Read`
- `Zone -> Zone -> Read`
- `Zone -> Workers Routes -> Edit`

If you are only deploying with GitHub Actions and attaching an already-existing route manually, the minimum practical set is:

- `Account -> Workers Scripts -> Edit`
- `Account -> Account Settings -> Read`
- `Zone -> Zone -> Read`

## Deploy Options

### Option 1: GitHub Actions

Push to `main` and the workflow [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml) will run:

```bash
npx wrangler deploy --account-id "$CF_ACCOUNT_ID" --api-token "$CF_API_TOKEN"
```

If you are using Cloudflare's Git-connected Builds flow on the free plan, the repo root now includes a minimal `package.json`, so a build command like `npm install && npm run build` will also pass cleanly.

### Option 2: Manual CLI

From the repo root:

```bash
npx wrangler deploy
```

## Custom Domain

After the Worker is deployed:

1. Open Cloudflare `Workers & Pages`
2. Open `velismail-backend`
3. Go to `Settings -> Domains & Routes`
4. Attach `api.velismail.online`

Then set this in Vercel:

```env
VITE_API_URL=https://api.velismail.online
```

## CORS

The Worker accepts every origin by default. If you want to lock it down, set:

```env
FRONTEND_ORIGIN=https://velismail.online,https://www.velismail.online
```

## Smoke Test

After deploy:

```bash
curl https://api.velismail.online/health
curl https://api.velismail.online/api/v1/health
```

Both should return JSON with `success: true`.

## Real OTP Mail Requirement

The Worker now sends real OTP emails through Brevo's HTTP API. For this flow you need a Brevo API key, not only SMTP relay credentials.

## Company Domain Sender

Do not use `@gmail.com` or any other free mailbox as `MAIL_FROM_EMAIL` or `OTP_FROM_EMAIL`. Brevo recommends sending from your own authenticated domain, and the Worker now rejects free-email senders for production mail.
