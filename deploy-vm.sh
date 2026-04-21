#!/bin/bash
# VelisMail VM Deployment Script
# This script prepares the AWS EC2 instance and deploys the backend services.

echo "======================================"
echo " Starting VelisMail VM Deployment"
echo "======================================"

# 1. Update the system
echo "[1/4] Updating system packages..."
sudo apt-get update && sudo apt-get upgrade -y

# 2. Install Docker & Docker Compose if not present
echo "[2/4] Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "Docker installed successfully. Please log out and log back in for group changes to take effect if running manually."
else
    echo "Docker is already installed."
fi

# 3. Environment Variables
echo "[3/4] Checking environment configuration..."
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "Created .env from .env.example."
        echo "IMPORTANT: Please edit .env with your production credentials (database password, JWT secret, etc.)"
    else
        echo "Warning: .env.example not found. Please ensure your environment variables are configured."
    fi
else
    echo ".env file already exists."
fi

# 4. Build and run containers
echo "[4/4] Building and starting VelisMail services..."
# Using Docker Compose V2
sudo docker compose up --build -d

echo "======================================"
echo " Deployment completed successfully!"
echo " Services are starting in the background."
echo " Use 'sudo docker compose ps' to check their status."
echo " Use 'sudo docker compose logs -f' to view logs."
echo "======================================"
