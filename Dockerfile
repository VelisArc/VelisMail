# Multi-stage Rust build — one image per service, selected via SERVICE build arg.
# Build: docker build --build-arg SERVICE=auth-service -t velismail/auth .

FROM rust:1.91.1-slim-bookworm AS builder
ARG SERVICE=api-gateway
ENV SERVICE=${SERVICE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates build-essential curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY libs ./libs
COPY services ./services

RUN cargo build --release --bin ${SERVICE}

# --- Runtime ---
FROM debian:bookworm-slim
ARG SERVICE=api-gateway
ENV SERVICE=${SERVICE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -u 10001 -m appuser

WORKDIR /app
COPY --from=builder /src/target/release/${SERVICE} /app/service
COPY --from=builder /src/services/${SERVICE} /tmp/service-src
RUN if [ -d /tmp/service-src/migrations ]; then cp -r /tmp/service-src/migrations /app/migrations; fi \
 && rm -rf /tmp/service-src

USER appuser
EXPOSE 3000
CMD ["/app/service"]
