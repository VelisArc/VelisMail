# VelisMail v4.0.5 Release Checklist

## Required before push

- Revoke any GitHub token that was exposed in screenshots or chat.
- Configure GitHub auth with a fresh PAT or SSH key.
- Fetch `VelisArc/VelisMail` remote history and reconcile without force pushing.
- Confirm no `.env`, private keys, DKIM private key files, or provider secrets are tracked.

## Verification gates

Run these locally or in GitHub Actions:

```bash
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd frontend && npm ci && npm run lint && npm run test && npm run build
docker compose --env-file .env.example -f docker-compose.prod.yml config
```

## Release commands

```bash
git status --short
git add .
git commit -m "release: v4.0.5 platform admin directory"
git tag -a v4.0.5 -m "VelisMail v4.0.5"
git push origin main
git push origin v4.0.5
```

## Post-deploy smoke test

- `curl https://api.velismail.online/health` reports version `4.0.5`.
- Register, login, refresh token, and logout work.
- Failed login lockout returns `429` after configured threshold.
- `/auth/sessions` lists active sessions for the authenticated user.
- Revoking a session removes it from the active session list.
- Storage upload stores encrypted objects and quota reflects stored metadata.
- Cloudflare Pages deploy serves the current frontend build.

## Rollback

```bash
git revert <release_commit_sha>
git push origin main
```

On the VM:

```bash
cd ~/VelisMail
git fetch --all
git reset --hard origin/main
bash deploy-vm.sh up
```
