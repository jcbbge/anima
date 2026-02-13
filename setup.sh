#!/usr/bin/env bash
set -e

echo "Setting up Anima..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Docker required: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check Bun
if ! command -v bun &> /dev/null; then
    echo "Bun required: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Install deps
bun install

# Create .env
if [ ! -f .env ]; then
    echo "DATABASE_URL=postgres://anima:anima_dev_password@localhost:7101/anima" > .env
fi

# Start services
docker compose up -d

# Wait for PostgreSQL
echo "Waiting for PostgreSQL..."
for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U anima > /dev/null 2>&1; then
        echo "PostgreSQL ready"
        break
    fi
    sleep 1
done

# Wait for Ollama
echo "Waiting for Ollama..."
for i in {1..60}; do
    if curl -s http://localhost:7102/api/tags > /dev/null 2>&1; then
        echo "Ollama ready"
        break
    fi
    sleep 1
done

echo ""
echo "Setup complete. Run 'bun dev' to start the API."
