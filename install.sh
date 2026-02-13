#!/usr/bin/env bash
set -e

echo "Installing Anima..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Docker required. Install from https://docs.docker.com/get-docker/"
    exit 1
fi

# Check Bun
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Clone repo
ANIMA_DIR="$HOME/anima"
if [ -d "$ANIMA_DIR" ]; then
    echo "Updating existing installation..."
    cd "$ANIMA_DIR" && git pull
else
    echo "Cloning repository..."
    git clone https://github.com/jcbbge/anima.git "$ANIMA_DIR"
fi

# Setup
cd "$ANIMA_DIR"
bun install

# Create .env if needed
if [ ! -f .env ]; then
    echo "DATABASE_URL=postgres://anima:anima_dev_password@localhost:7101/anima" > .env
fi

# Install CLI
mkdir -p "$HOME/bin"
ln -sf "$ANIMA_DIR/cli/anima" "$HOME/bin/anima" 2>/dev/null || cp "$ANIMA_DIR/cli/anima" "$HOME/bin/anima"
chmod +x "$HOME/bin/anima"

echo ""
echo "Installed to $ANIMA_DIR"
echo "CLI available as 'anima' (restart terminal or run: export PATH=\"\$HOME/bin:\$PATH\")"
echo ""
echo "Start services: cd ~/anima && docker compose up -d"
