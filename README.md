# VelisMail

VelisMail is a privacy-focused mail platform built as a Rust microservice backend with a React/Vite frontend. The project includes authentication, mailbox workflows, encrypted storage, tenant/domain management, delivery plumbing, Docker Compose for local infrastructure, and GitHub Actions for CI.

## Stack

- Rust workspace with Axum services
- PostgreSQL, Redis, NATS, and S3-compatible object storage
- React, TypeScript, Vite, Zustand, and Vitest frontend
- Docker Compose for local development
- Kubernetes config templates for cluster deployment

## Services

| Service | Port | Purpose |
| --- | ---: | --- |
| `api-gateway` | 3000 | Public API routing and OpenAPI surface |
| `auth-service` | 3001 | Accounts, JWTs, refresh tokens, passkey flow |
| `mail-service` | 3002 | Mailbox, compose, threading, rules, delivery dispatch |
| `storage-service` | 3003 | S3-backed attachment and file storage |
| `tenant-service` | 3004 | Organizations, custom domains, DNS verification |
| `delivery-engine` | 3005 | SPF/DKIM/DMARC, reputation, bounce handling |

## Quick Start

Prerequisites:

- Rust stable
- Node.js 22 or newer
- Docker Desktop

Create local environment values:

```powershell
Copy-Item .env.example .env
```

Start local infrastructure and services:

```powershell
docker compose up --build
```

Run the frontend locally:

```powershell
cd frontend
npm install
npm run dev
```

Run backend checks:

```powershell
cargo fmt --all -- --check
cargo test --workspace
```

Run frontend checks:

```powershell
cd frontend
npm run lint
npm run test
npm run build
```

## Security Notes

- Never commit `.env`, `k8s/secrets.yml`, private keys, or production credentials.
- Use `.env.example` and `k8s/secrets.example.yml` as templates only.
- Rotate any token or password that has been shared in a screenshot, chat, commit, or log.
- Replace all development defaults before running outside a local machine.

## Repository Layout

```text
frontend/                 React/Vite web app
libs/                     Shared Rust crates
services/                 Rust microservices
k8s/                      Kubernetes config templates
.github/workflows/        CI workflow
docker-compose.yml        Local infrastructure and service stack
```

