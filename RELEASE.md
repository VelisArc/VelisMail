# VelisMail v5.2.0 Release Checklist

# Verification gates
```bash
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd frontend && npm ci && npm run lint && npm run test && npm run build
```

# Native deployment smoke test
```bash
sudo bash deploy/native/install.sh
curl https://api.velismail.online/health
```

# Notes
- Docker files were removed; deploy with `deploy/native/install.sh`.
- Backend layout is `backend/crates` and `backend/services`.

