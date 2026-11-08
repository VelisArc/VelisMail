# VelisMail — Rust monolith service (all internal services in one process)
#
# Build:   docker build -f backend/Dockerfile -t velismail-monolith .
# Run:     docker run -p 3000:3000 --env-file .env.production velismail-monolith
# Render:  point a Docker Web Service at repo root with this Dockerfile;
#          Render sets PORT automatically and health-checks /health.
FROM rust:1-bookworm AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        cmake perl pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN cargo build --release --bin velismail-monolith

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 1000 velismail

COPY --from=builder --chown=velismail:velismail /app/target/release/velismail-monolith /usr/local/bin/velismail-monolith

USER velismail
WORKDIR /app

ENV RUST_LOG=info \
    APP_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["velismail-monolith"]
