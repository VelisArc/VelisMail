# VelisMail

VelisMail now uses a clean split deployment:

- `frontend/` deploys to Cloudflare Pages
- the Rust backend in `services/` deploys to a Linux VM with Docker Compose

## Final env files

- Backend: [`.env`](/c:/Users/Mangal/Downloads/VelisMail/.env)
- Frontend: [`frontend/.env`](/c:/Users/Mangal/Downloads/VelisMail/frontend/.env)

Only these two env files are required now.

## Backend deploy

Fill the blank external values in `.env`, then on the VM run:

```bash
bash deploy-vm.sh up
```

The API gateway will serve the backend on `GATEWAY_PORT`.

## Frontend deploy

Set `VITE_API_URL` in `frontend/.env` to your public backend URL, then deploy:

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
