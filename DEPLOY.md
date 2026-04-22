# VelisMail — Split Deployment Guide

**Backend** (Rust microservices + Postgres + Redis + NATS) → **Linux VM / VPS**
**Frontend** (React + Vite SPA) → **Cloudflare Pages**

---

## 1. Backend on VM

### Requirements
- Ubuntu 22.04+ / Debian 12+ VM, ≥ 2 vCPU, 4 GB RAM, 20 GB disk
- Docker Engine + Docker Compose v2 (`docker compose version`)
- A domain like `api.velismail.online` pointing (A-record) to the VM IP
- TLS — recommend putting Caddy / Nginx / Cloudflare Tunnel in front of port 3000

### Steps
```bash
git clone https://github.com/VelisArc/VelisMail.git
cd VelisMail
cp .env.production.example .env.production
# Edit .env.production — at minimum set POSTGRES_PASSWORD, REDIS_PASSWORD,
# JWT_SECRET (use `openssl rand -hex 64`), SMTP_* values.

bash deploy-vm.sh           # builds all Rust services + starts stack
bash deploy-vm.sh logs      # watch logs
curl http://localhost:3000/health
```

### TLS (recommended: Caddy)
```caddy
api.velismail.online {
    reverse_proxy 127.0.0.1:3000
}
```
Then set `GATEWAY_BIND=127.0.0.1` in `.env.production` so only Caddy can reach it.

### What works out of the box
- `POST /api/v1/auth/register` — email+password registration (Argon2 hashed)
- `POST /api/v1/auth/login` — password login, returns real JWT access + refresh
- `POST /api/v1/auth/token/refresh` — rotates refresh token
- `GET  /api/v1/tenants/...` — real tenant CRUD (DB-backed)
- `GET  /api/v1/verify/providers` + `POST /api/v1/verify` — infrastructure verification

### Known limitations (documented 501s)
The following endpoints return **501 Not Implemented** until the real protocols ship:
- `POST /api/v1/auth/login/passkey` — full WebAuthn signature verification
- `GET  /api/v1/auth/me` — JWT-middleware-backed user lookup

The following services are scaffolded and respond but need their business logic
wired to real DB/SMTP/S3 calls (see TODO comments in source):
- `mail-service` — email CRUD (DB inserts are stubbed)
- `storage-service` — S3 upload/download
- `delivery-engine` — SPF/DKIM/DMARC/bounce

The previous build returned **fake data pretending to succeed** (hard-coded
JWTs, fake message IDs, base64 that wasn't base64, a WebAuthn signature
verifier that accepted everything). Those have all been removed or replaced.

---

## 2. Frontend on Cloudflare Pages

### Option A — Dashboard (git-connected, recommended)
1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Repo: `VelisArc/VelisMail`. Branch: `main`.
3. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm ci && npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `frontend`
4. Environment variables (Production):
   - `VITE_API_URL` = `https://api.velismail.online`
   - `VITE_APP_ORIGIN` = `https://velismail.online`
5. Save & deploy. Pages will give you `*.pages.dev`. Add a custom domain
   (`velismail.online`) under the **Custom domains** tab.

### Option B — CLI (manual)
```bash
cd frontend
npm ci
VITE_API_URL=https://api.velismail.online npm run build
npx wrangler pages deploy dist --project-name velismail
```

### CORS
The VM API gateway uses `CorsLayer::permissive()` so any origin works. Once
stable, tighten it in `services/api-gateway/src/main.rs` to the exact Pages URL.

---

## 3. Cleanup of legacy artifacts

The root-level `worker.js` and `wrangler.toml` were from an earlier Cloudflare-
Worker-only deployment and are no longer used in the split architecture.
They can be safely deleted:
```bash
rm worker.js wrangler.toml
```
(The `frontend/wrangler.toml` is the Pages config and should be kept.)

---

## 4. Troubleshooting

| Symptom                                 | Fix                                                            |
|-----------------------------------------|----------------------------------------------------------------|
| `cargo build` fails on sqlx offline     | Set `SQLX_OFFLINE=true` or run Postgres first                  |
| Frontend gets CORS error                | Ensure `VITE_API_URL` has correct scheme + no trailing slash   |
| Register returns 500                    | Check `auth-service` logs — usually migration 002 not applied  |
| Passkey login returns 501               | Expected — use `/login` (password) until WebAuthn ships         |
| `deploy-vm.sh` says env missing         | Copy `.env.production.example` → `.env.production`             |

---

## 5. What changed vs. the previous codebase (summary)

- **Security:** Removed a `verify_signature` stub that returned `Ok(true)` for
  any passkey signature. Replaced fake inline base64 encoder/decoder with the
  real `base64` crate.
- **Auth:** Added working password-based register/login (Argon2 + real JWT).
  The old `/login/zkp` returned a hard-coded `"jwt_token_here"` string.
- **API Gateway:** Was returning fake JSON for every endpoint. Now it is a real
  reverse proxy to the downstream services.
- **Session bug:** `SELECT ... user_id` was being read as `i64` then cast to
  `u128` — corrupted UUIDs. Fixed to read as `Uuid` directly.
- **`list_user_sessions`** was returning `Uuid::new_v4()` as user_id (i.e.
  random garbage). Fixed to propagate the queried user's UUID.
- **Deployment:** Split into `docker-compose.prod.yml` (VM) + `frontend/` on
  Cloudflare Pages, each with its own env file. Previous single Cloudflare
  Worker deploy is deprecated.
