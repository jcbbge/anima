#!/usr/bin/env bash
set -e

echo "🌱 Installing Anima..."
echo ""

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required. Install Docker Desktop first."
    echo "   Visit: https://www.docker.com/products/docker-desktop"
    exit 1
fi

if ! command -v bun &> /dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Check if OpenCode is installed
if ! command -v opencode &> /dev/null; then
    echo "❌ OpenCode is required for this installation."
    echo "   This installer is specifically for OpenCode users."
    echo "   Install OpenCode: https://opencode.ai"
    exit 1
fi

echo "✅ Prerequisites satisfied"
echo ""

# Clone or update repo
ANIMA_DIR="$HOME/.anima"
if [ -d "$ANIMA_DIR" ]; then
    echo "📂 Anima already exists at $ANIMA_DIR"
    echo "   Pulling latest changes..."
    cd "$ANIMA_DIR"
    git pull
else
    echo "📥 Cloning Anima to $ANIMA_DIR..."
    git clone https://github.com/YOUR_USERNAME/anima.git "$ANIMA_DIR"
    cd "$ANIMA_DIR"
fi

echo ""

# Run setup
echo "🔧 Running setup..."
./setup.sh

echo ""

# Install CLI globally
echo "🔗 Installing CLI to ~/bin/anima..."
mkdir -p ~/bin

# Create wrapper that points to actual install
cat > ~/bin/anima << 'EOF'
#!/usr/bin/env bash
# Anima CLI wrapper
exec "$HOME/.anima/cli/anima" "$@"
EOF

chmod +x ~/bin/anima

# Add to PATH if needed
if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
    echo ""
    echo "📝 Adding ~/bin to PATH..."
    
    # Detect shell
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        SHELL_RC="$HOME/.bashrc"
    else
        SHELL_RC="$HOME/.profile"
    fi
    
    echo 'export PATH="$HOME/bin:$PATH"' >> "$SHELL_RC"
    export PATH="$HOME/bin:$PATH"
    echo "✅ Added to $SHELL_RC"
fi

# Install OpenCode integration files
echo ""
echo "🎯 Installing OpenCode integration..."

# 1. Custom tool (auto-bootstrap)
echo "   Installing anima_bootstrap tool..."
mkdir -p ~/.config/opencode/tool
cp "$ANIMA_DIR/.opencode/tool/anima-bootstrap.ts" ~/.config/opencode/tool/
echo "   ✅ Tool installed"

# 2. Global AGENTS.md (if doesn't exist, create it; if exists, append)
echo "   Configuring global AGENTS.md..."
if [ -f ~/.config/opencode/AGENTS.md ]; then
    # Check if Anima section already exists
    if ! grep -q "## CRITICAL: Anima Memory System" ~/.config/opencode/AGENTS.md; then
        echo "" >> ~/.config/opencode/AGENTS.md
        cat "$ANIMA_DIR/.opencode/AGENTS.md.template" >> ~/.config/opencode/AGENTS.md
        echo "   ✅ Anima section added to existing AGENTS.md"
    else
        echo "   ⚠️  Anima section already exists in AGENTS.md"
    fi
else
    cp "$ANIMA_DIR/.opencode/AGENTS.md.template" ~/.config/opencode/AGENTS.md
    echo "   ✅ AGENTS.md created"
fi

# 3. Skill (reference documentation)
echo "   Installing skill..."
mkdir -p ~/.config/opencode/skill/anima
cp "$ANIMA_DIR/.opencode/skill/anima/SKILL.md" ~/.config/opencode/skill/anima/
echo "   ✅ Skill installed"

echo ""
echo "✅ OpenCode integration complete"

# Start services
echo ""
echo "🚀 Starting Anima services..."
cd "$ANIMA_DIR"
docker compose up -d
sleep 3

# Test
echo ""
echo "🧪 Testing installation..."
if ~/bin/anima stats > /dev/null 2>&1; then
    echo "✅ Anima is working!"
else
    echo "⚠️  Anima installed but API may not be ready yet"
    echo "   Wait 10 seconds and try: anima stats"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Anima installed successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 Integration installed:"
echo "   • Custom tool: ~/.config/opencode/tool/anima-bootstrap.ts"
echo "   • Global rules: ~/.config/opencode/AGENTS.md"
echo "   • Skill reference: ~/.config/opencode/skill/anima/SKILL.md"
echo ""
echo "🚀 Next Steps:"
echo "   1. Restart your terminal (or run: source ~/.zshrc)"
echo "   2. Start a new OpenCode conversation"
echo "   3. Anima will auto-bootstrap automatically"
echo ""
echo "🔧 Services:"
echo "   • Database: localhost:7101"
echo "   • API: localhost:7100"
echo "   • Location: ~/.anima/"
echo ""
echo "🛑 To stop: cd ~/.anima && docker compose down"
echo ""
