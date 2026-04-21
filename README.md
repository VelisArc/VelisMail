# VelisMail

VelisMail is now configured for a simple split deployment:

- `frontend/` deploys to Vercel
- `worker.js` deploys to Cloudflare Workers as the backend API

The React app remains local-first for mailbox data, and the Worker provides the lightweight API endpoints used by setup, auth, health checks, and mail-send requests.

## Deploy Targets

| Target | Path | Platform |
| --- | --- | --- |
| Frontend | `frontend/` | Vercel |
| Backend API | `worker.js` + `wrangler.toml` | Cloudflare Workers |

## Quick Start

Prerequisites:

- Node.js 22 or newer
- A Vercel project linked to `frontend`
- A Cloudflare account with Workers enabled

Frontend local dev:

```powershell
cd frontend
npm install
npm run dev
```

Worker local dev:

```powershell
npx wrangler dev
```

Frontend checks:

```powershell
cd frontend
npm run lint
npm run test
npm run build
```

## Production Setup

1. Vercel
   Set the project root directory to `frontend`.
   Add `VITE_API_URL=https://api.velismail.online`.

2. Cloudflare Workers
   Deploy from the repo root with `npx wrangler deploy`.
   Attach your custom domain such as `api.velismail.online`.
   Optionally set `FRONTEND_ORIGIN` to your Vercel production URL for tighter CORS.

3. GitHub Actions
   `.github/workflows/vercel-deploy.yml` deploys only the frontend directory.
   `.github/workflows/deploy-cloudflare.yml` deploys only the Worker.

## Notes

- Render-specific deployment files have been removed.
- The Rust workspace is still present as legacy source, but it is no longer part of the active Vercel + Cloudflare deployment flow.
- Never commit real secrets or production tokens.
