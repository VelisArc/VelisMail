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
