FROM rust:1.75-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY libs libs
COPY services services
WORKDIR /app/services/delivery-engine
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/delivery-engine /usr/local/bin/
RUN useradd -r -s /bin/false velismail
USER velismail
EXPOSE 3005
ENTRYPOINT ["/usr/local/bin/delivery-engine"]
