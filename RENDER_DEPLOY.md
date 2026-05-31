# VelisMail Render Deployment Guide

## Prerequisites

1. **Render Account** (free tier: https://render.com)
2. **GitHub** - Repo connected to Render
3. **Cloudflare** - DNS for `api.velismail.online` pointing to Render
4. **SMTP credentials** - Brevo/SendGrid/Resend for OTP emails
5. **Encryption key** - 32-byte base64 key for storage

## Step 1: Deploy Backend on Render

### Option A: Using render.yaml (Blueprint)

1. Push this repo to GitHub
2. In Render Dashboard → Blueprint → Connect your repo
3. Render reads `render.yaml` and auto-creates:
   - Web Service (`velismail-backend`) with Docker
   - PostgreSQL database (`velismail-db`) free tier
4. Set the **secret env vars** in Render Dashboard:
   ```
   JWT_SECRET       → 64+ char random string
   OTP_SIGNING_SECRET → long random string
   SMTP_HOST        → smtp-relay.brevo.com (or your provider)
   SMTP_PORT        → 587
   SMTP_USERNAME    → your smtp username
   SMTP_PASSWORD    → your smtp password
   OTP_FROM_EMAIL   → no-reply@velismail.online
   OTP_FROM_NAME    → VelisMail
   ENCRYPTION_KEY   → base64 32-byte key
   PUBLIC_API_URL   → https://api.velismail.online (or your Render URL)
   ```

### Option B: Manual Setup

1. In Render Dashboard → New Web Service
2. Connect your GitHub repo
3. Settings:
   - **Name**: `velismail-backend`
   - **Environment**: `Docker`
   - **Dockerfile Path**: `./Dockerfile.monolith`
   - **Plan**: Free
4. Add Environment Variables (all from `.env.monolith.example`)
5. Create a PostgreSQL database: New → PostgreSQL → Free plan
6. Copy the `Internal Database URL` to your `DATABASE_URL` env var

## Step 2: Point DNS

In Cloudflare DNS:
```
CNAME  api.velismail.online  →  velismail-backend.onrender.com
```
Enable Proxy (orange cloud) for DDoS protection and SSL.

## Step 3: Frontend (already on Cloudflare Pages)

The frontend at `velismail.online` uses `VITE_API_URL=https://api.velismail.online`.
Once DNS propagates, the frontend will talk to the Render backend.

## Env Vars Summary

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | From Render PostgreSQL (auto-filled with Blueprint) |
| `JWT_SECRET` | ✅ | 64+ char random |
| `OTP_SIGNING_SECRET` | ✅ | Long random string |
| `SMTP_HOST` | ✅ | e.g. smtp-relay.brevo.com |
| `SMTP_PORT` | ✅ | 587 (STARTTLS) or 465 (TLS) |
| `SMTP_USERNAME` | ✅ | Your SMTP login |
| `SMTP_PASSWORD` | ✅ | Your SMTP password |
| `OTP_FROM_EMAIL` | ✅ | Sender address for OTP mails |
| `OTP_FROM_NAME` | ✅ | Sender name |
| `ENCRYPTION_KEY` | ✅ | base64 32-byte key: `openssl rand -base64 32` |
| `FRONTEND_URL` | ✅ | `https://velismail.online` |
| `PUBLIC_API_URL` | ✅ | `https://api.velismail.online` |
| `BASE_DOMAIN` | ✅ | `velismail.online` |

## What Changed (Monolith Architecture)

The original 6 microservices + Caddy + NATS + Redis are now ONE binary:
- All services run in a single process
- Internal HTTP on localhost (ports 3001-3005)
- API Gateway exposed on Render PORT (10000)
- Redis is optional (auth falls back to PostgreSQL)
- NATS removed (was unused, no subscriber existed)
- No Caddy needed (Render terminates TLS automatically)
