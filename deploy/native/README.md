# Native, Docker-free VelisMail deployment

VelisMail runs as independent systemd services behind Caddy. Each service can be
restarted, observed and (where it is stateless) scaled independently.

## Layout

- `deploy/native/build.sh` builds all Rust services.
- `deploy/native/install.sh` installs binaries, systemd units, PostgreSQL tuning,
  Caddy and the environment file.
- `deploy/native/check-env.sh` validates the dotenv file before systemd loads it
  (balanced quotes, valid names, no duplicate keys, no CRLF).
- `deploy/native/tune-memory.sh` adds compressed RAM swap (zram) and disk swap.
  It runs automatically from `install.sh` and keeps 2 GB VMs stable without an
  instance-type change.
- `deploy/native/backup.sh` writes a compressed PostgreSQL dump to
  `/var/backups/velismail` (daily timer, 7-day retention).
- `deploy/native/deploy-fast.sh` installs already-built binaries and restarts
  services with a health gate.
- `deploy/native/setup-elastic-ip.sh` allocates or reuses an Elastic IP and
  associates it with the EC2 instance, so stop/start does not change the public
  API address (requires AWS credentials).
- `backend/` contains the Rust workspace:
  - `backend/crates/` shared libraries (traffic, crypto, email, database)
  - `backend/services/` independently deployable services

## Services

| Service | Port | Writable state |
| --- | --- | --- |
| api-gateway | 3000 | none |
| auth-service | 3001 | none |
| mail-service | 3002 | none |
| storage-service | 3003 | `/var/lib/velismail/storage` |
| tenant-service | 3004 | none |
| delivery-engine | 3005 | none |

## First-time deployment

```bash
# On the VM, from the repository root:
sudo bash deploy/native/install.sh

# Reuse existing release binaries (routine updates):
sudo bash deploy/native/install.sh --skip-build

# Binary-only fast deploy after deploy/native/build.sh:
sudo bash deploy/native/deploy-fast.sh
```

`install.sh` validates `DATABASE_URL`, `JWT_SECRET`, `OTP_SIGNING_SECRET`,
`ENCRYPTION_KEY` and `PLATFORM_RESEND_API_KEY`, refuses placeholder secrets,
rejects weak or non-URL-safe `POSTGRES_PASSWORD` values, creates the PostgreSQL
role/database, applies conservative PostgreSQL tuning for a 2 vCPU / 2 GB
instance, installs memory-capped systemd units and configures Caddy.

## Environment file safety

systemd reads `/etc/velismail/velismail.env` as an `EnvironmentFile`. A value
with an **unbalanced quote** (for example a truncated PEM key) makes systemd
treat every following line as a continuation, silently hiding variables such as
`DATABASE_URL`. This looks like a random "missing required environment variable"
failure at runtime.

Always validate the file before restarting services:

```bash
sudo bash deploy/native/check-env.sh /etc/velismail/velismail.env
```

Rules enforced by the installer:

- one `KEY=VALUE` per line, no `export`, no multi-line values unless quoted
- balanced single/double quotes
- `POSTGRES_PASSWORD` is 16+ chars, not a repeated character, and uses only
  letters, digits, `_` and `-` (it is embedded in `DATABASE_URL` unencoded)
- LF line endings (CRLF is normalised automatically)
- no duplicate keys
- no service host/port variables (`PORT`, `GATEWAY_PORT`, `AUTH_HOST`, ...);
  systemd supplies those per unit. EnvironmentFile values would override them
  and break multi-instance gateway scaling.

## Traffic handling

- Per-IP fixed-window rate limits in the gateway (`RATE_LIMIT_PER_MINUTE`,
  stricter `AUTH_RATE_LIMIT_PER_MINUTE` for `/api/v1/auth/*`).
- Concurrency cap (`MAX_CONCURRENT_REQUESTS`, default 256) returns 503 +
  `Retry-After` instead of exhausting memory.
- Request body cap (`GATEWAY_MAX_BODY_MB`), request timeout
  (`REQUEST_TIMEOUT_SECONDS`), gzip/zstd compression, panic catching and
  graceful shutdown.
- Every service validates the JWT locally and exposes `/health` + `/ready`.
- Prometheus metrics at `/metrics`, protected by `METRICS_TOKEN`
  (`Authorization: Bearer <token>`). The endpoint returns 404 when no token is
  configured.
- Caddy adds its own timeouts, least-connection load balancing, passive/active
  upstream health checks and retry budgets.

## Memory hardening (2 GB VMs)

`install.sh` calls `tune-memory.sh`, which configures:

- zram compressed RAM swap (`zstd`, 50% of RAM, priority 100)
- a 4 GB disk swapfile (separate from any existing swapfile) as a safety net;
  every detected swapfile is enabled and persisted in `/etc/fstab` so it
  survives reboots
- `vm.swappiness=100`, `vm.page-cluster=0` (zram prefers compressed swap over
  dropping cache), `vm.min_free_kbytes=64MB`, predictable overcommit
- OOM protection for PostgreSQL (`-900`) and Caddy (`-500`)
- per-service `MemoryHigh` (soft) and `MemoryMax` (hard) limits with auto-restart
- `cargo` build jobs limited to 2 on 2 vCPU hosts

This means a 2 GB host runs the full stack without OOM crashes; upgrading the
instance type later only increases headroom and speed.

## Scaling

Only the stateless gateway is scaled on a single VM:

```bash
sudo SCALE=2 bash deploy/native/install.sh --skip-build
```

Caddy load-balances `127.0.0.1:3000` and `127.0.0.1:3100`. Internal services run
as a single instance on this 2 GB host; for multi-VM scale-out, run the
installer on additional hosts and point the gateway's `AUTH_SERVICE_URL`,
`MAIL_SERVICE_URL`, `STORAGE_SERVICE_URL`, `TENANT_SERVICE_URL` and
`DELIVERY_SERVICE_URL` values at those hosts (or a private load balancer).

## DNS and TLS

Production API: **https://api.velismail.online**. Caddy issues and renews the
Let's Encrypt certificate automatically. The public DNS record is:

```
api.velismail.online.  A  3.80.98.223
```

Keep the record **DNS-only (grey cloud)** while Caddy uses the TLS-ALPN/HTTP-01
challenges. If you later enable the Cloudflare proxy, set SSL/TLS mode to
**Full (strict)** and confirm renewals still pass; Cloudflare's "Always Use
HTTPS" can block the HTTP-01 challenge.

### Elastic IP (optional; recommended before stop/start)

The public IPv4 address of an EC2 instance without an Elastic IP changes when
the instance is stopped, for example during an instance-type resize. That
breaks DNS until the record is updated. This deployment currently runs without
an Elastic IP by choice; if the instance is stopped, update the Cloudflare
`api` A record to the new public IPv4. To make the address stable, allocate and
associate one:

```bash
AWS_REGION=us-east-1 bash deploy/native/setup-elastic-ip.sh i-0d1aaba1e183e73c7
```

Run it from a machine with AWS credentials or from **AWS CloudShell** in the same
account. The script reuses an existing VelisMail-tagged or already-associated
address when possible, is safe to re-run, and prints the new public IPv4. Then
update the Cloudflare `api` A record and verify:

```bash
curl -fsS https://api.velismail.online/health/ready
```

Required IAM permissions: `ec2:DescribeInstances`, `ec2:DescribeAddresses`,
`ec2:AllocateAddress`, `ec2:AssociateAddress`, `ec2:CreateTags`.

Console alternative: **EC2 → Elastic IPs → Allocate Elastic IP address** (tag
`Project=VelisMail`), then **Actions → Associate** with instance
`i-0d1aaba1e183e73c7`, and update the Cloudflare record. The previous
auto-assigned address is released as soon as the Elastic IP is associated.

### Email authentication (Resend)

`velismail.online` is a verified Resend domain, so platform mail is DKIM-signed
by Resend (selector `resend`) and uses the `send.velismail.online` envelope
domain. Resend owns that DKIM key; `DKIM_PRIVATE_KEY` stays empty for platform
mail.

| Record | Value / purpose |
| --- | --- |
| `resend._domainkey.velismail.online` TXT | Resend DKIM public key |
| `send.velismail.online` TXT | `v=spf1 include:amazonses.com ~all` |
| `send.velismail.online` MX | `10 feedback-smtp.ap-northeast-1.amazonaws.com` |
| `velismail.online` MX | `10 inbound-smtp.ap-northeast-1.amazonaws.com` |

A DMARC record is still recommended. Add this TXT record in Cloudflare:

```
_dmarc.velismail.online  TXT  v=DMARC1; p=none; rua=mailto:YOUR_MONITORED_EMAIL; adkim=r; aspf=r; fo=1
```

Replace `YOUR_MONITORED_EMAIL` before saving; publishing the placeholder
literally means DMARC reports are discarded. Start with `p=none`, review the
aggregate reports for 1-2 weeks, then move to `quarantine` and finally
`reject`. An apex SPF record is only needed if
something sends as `@velismail.online`; Resend uses the `send` subdomain.

## Operations

```bash
systemctl status 'velismail-*'
journalctl -u velismail-api-gateway-1 -f
sudo bash deploy/native/check-env.sh /etc/velismail/velismail.env
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/health/ready | jq
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/metrics
```

### Rotating the Resend API key

The platform key is stored only in `/etc/velismail/velismail.env` and the
repository `.env` used by the installer. To rotate it:

1. Create a new **full access** key in Resend (Dashboard → API Keys) or via
   `POST https://api.resend.com/api-keys`.
2. Set `PLATFORM_RESEND_API_KEY` to the new `re_...` value in `.env`.
3. Run `sudo SYNC_ENV=1 bash deploy/native/install.sh --skip-build`.
4. Verify `https://api.velismail.online/health/ready` and send a test message.
5. Delete the old key in Resend.

Keep only one `velismail-platform-*` key active. Rotating invalidates the old
key immediately, so update and restart before revoking it.

To deploy an updated `.env` explicitly:

```bash
sudo SYNC_ENV=1 bash deploy/native/install.sh --skip-build
```

Without `SYNC_ENV=1` the installer leaves the installed env file untouched and
prints a warning when the repository copy differs.

## Backups and restore

`install.sh` installs `velismail-backup.timer`, which runs `pg_dump` daily at
02:30 UTC into `/var/backups/velismail` and keeps 7 days of dumps. Trigger a
backup immediately with:

```bash
sudo systemctl start velismail-backup.service
sudo systemctl status velismail-backup.service
sudo ls -lh /var/backups/velismail
```

Restore into a stopped application (destructive):

```bash
sudo systemctl stop 'velismail-*'
sudo -u postgres pg_restore --clean --if-exists \
  --dbname=velismail /var/backups/velismail/velismail-YYYYmmdd-HHMMSS.dump
sudo systemctl start 'velismail-*'
```

Attachments under `/var/lib/velismail/storage` are not part of the database
dump. Back them up separately (for example `restic` or `rclone` to object
storage). Disable the timer with `ENABLE_BACKUPS=0` when running `install.sh`.

The `.env` file lives at `/etc/velismail/velismail.env` (root:velismail, 0640).
After editing it, restart the affected units:

```bash
sudo systemctl restart velismail-api-gateway-1
```
