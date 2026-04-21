# Multi-stage Dockerfile for VelisMail services

# Build stage
FROM rust:1.75-bookworm AS builder
ARG SERVICE_NAME
ARG BINARY_NAME

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY libs libs

# Copy service files
COPY services services

# Build the service
WORKDIR /app/services/${SERVICE_NAME}
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
ARG BINARY_NAME
ARG PORT

RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy binary
COPY --from=builder /app/target/release/${BINARY_NAME} /usr/local/bin/

# Create non-root user
RUN useradd -r -s /bin/false velismail
USER velismail

EXPOSE ${PORT}

ENTRYPOINT ["/usr/local/bin/${BINARY_NAME}"]
