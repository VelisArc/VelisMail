# Cloudflare Worker Setup Guide (Hinglish)

Ab backend ke liye Render ya container ki zarurat nahi hai. Is repo me backend directly [`worker.js`](worker.js) se Cloudflare Worker par deploy hoga.

## Worker Kya Handle Karta Hai

- `GET /health`
- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login/zkp`
- `POST /api/v1/auth/login/passkey`
- `POST /api/v1/verify`
- `POST /api/v1/tenants/verify-domain`
- `POST /api/v1/mail/send`

## GitHub Secrets Kya Chahiye

GitHub repo me jao:
`Settings -> Secrets and variables -> Actions`

Add karo:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `BREVO_API_KEY`
- `BREVO_SENDER_NAME`
- `OTP_SIGNING_SECRET`
- `PRIMARY_MAIL_DOMAIN`
- `MAIL_FROM_EMAIL`
- `MAIL_FROM_NAME`
- `OTP_FROM_EMAIL`
- `ALLOWED_SENDER_DOMAINS`

Optional:

- `FRONTEND_ORIGIN=https://velismail.online`
- `OTP_TTL_SECONDS=600`

## Cloudflare Token Permissions

Custom API token banao with:

- `Account -> Workers Scripts -> Edit`
- `Account -> Workers Routes -> Edit`
- `Account -> Account Settings -> Read`
- `Zone -> Zone -> Read`
- `Zone -> Workers Routes -> Edit`

## Deploy Ka Best Flow

### Option 1: GitHub Actions

`main` branch pe push karte hi [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml) chalega aur Worker deploy ho jayega.

### Option 2: Manual CLI

Repo root se:

```bash
npx wrangler deploy
```

## Custom Domain Kaise Lagana Hai

1. Cloudflare Dashboard open karo
2. `Workers & Pages` me `velismail-backend` select karo
3. `Settings -> Domains & Routes` me jao
4. `api.velismail.online` add karo

## Vercel Me Kya Set Karna Hai

Frontend Vercel project me:

```env
VITE_API_URL=https://api.velismail.online
```

Important:

- Vercel project ka root directory `frontend` hona chahiye
- Backend ke liye koi `BACKEND_API_URL` ab nahi chahiye
- Worker khud hi API backend hai, proxy nahi

## CORS Lock Karna Ho To

Cloudflare Worker me env variable set karo:

```env
FRONTEND_ORIGIN=https://velismail.online,https://www.velismail.online
```

## Test

Deploy ke baad ye check karo:

```bash
curl https://api.velismail.online/health
curl https://api.velismail.online/api/v1/health
```

JSON me `success: true` aana chahiye.

## Real OTP Note

Worker ab real OTP email Brevo ke HTTP API se bhejta hai. Sirf SMTP relay password se kaam nahi chalega; Brevo API key chahiye.

## Company Mail Note

`gmail.com` sender mat use karo. Apne domain ka verified email use karo, jaise:

```env
PRIMARY_MAIL_DOMAIN=velismail.online
MAIL_FROM_EMAIL=noreply@velismail.online
OTP_FROM_EMAIL=verify@velismail.online
ALLOWED_SENDER_DOMAINS=velismail.online
```
