#!/usr/bin/env bash
set -e

echo "🧬 Anima V1 Setup Script"
echo "========================"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop."
    exit 1
fi

if ! command -v bun &> /dev/null; then
    echo "⚠️  Bun is not installed. Installing..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

echo "✅ Prerequisites satisfied"
echo ""

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'EOF'
# Anima V1 Environment Configuration

# Database
POSTGRES_PASSWORD=anima_dev_password

# Node Environment
NODE_ENV=development

# Embedding Provider (ollama or openai)
EMBEDDING_PROVIDER=ollama

# OpenAI API Key (only needed if EMBEDDING_PROVIDER=openai)
# OPENAI_API_KEY=sk-your-key-here
EOF
    echo "✅ .env created with default values"
else
    echo "✅ .env already exists"
fi
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
bun install
echo "✅ Dependencies installed"
echo ""

# Start Docker services (only postgres and ollama, API will start manually)
echo "🐳 Starting Docker services..."
docker compose up -d postgres ollama

echo ""
echo "⏳ Waiting for services to be healthy..."

# Wait for PostgreSQL
echo "   Waiting for PostgreSQL..."
max_attempts=30
attempt=0
until docker compose exec -T postgres pg_isready -U anima > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -eq $max_attempts ]; then
        echo "❌ PostgreSQL failed to start after 30 seconds"
        docker compose logs postgres
        exit 1
    fi
    sleep 1
    echo -n "."
done
echo ""
echo "✅ PostgreSQL is ready"

# Verify database schema
echo "   Verifying database schema..."
table_count=$(docker compose exec -T postgres psql -U anima -d anima -t -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';" | tr -d ' ')
if [ "$table_count" -eq "4" ]; then
    echo "✅ Database schema created (4 tables)"
else
    echo "❌ Database schema incomplete (found $table_count tables, expected 4)"
    exit 1
fi

# Verify extensions
echo "   Verifying pgvector extension..."
extension_count=$(docker compose exec -T postgres psql -U anima -d anima -t -c "SELECT COUNT(*) FROM pg_extension WHERE extname IN ('uuid-ossp', 'vector');" | tr -d ' ')
if [ "$extension_count" -eq "2" ]; then
    echo "✅ Extensions installed (uuid-ossp, vector)"
else
    echo "❌ Extensions missing"
    exit 1
fi

# Wait for Ollama
echo "   Waiting for Ollama..."
max_attempts=60
attempt=0
until curl -s http://localhost:7002/api/tags > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -eq $max_attempts ]; then
        echo "⚠️  Ollama took too long to start, but continuing..."
        break
    fi
    sleep 1
    echo -n "."
done
echo ""
if curl -s http://localhost:7102/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama is ready"
    
    # Check if nomic-embed-text is pulled
    if docker compose exec -T ollama ollama list | grep -q "nomic-embed-text"; then
        echo "✅ Embedding model (nomic-embed-text) is ready"
    else
        echo "⚠️  Embedding model not yet pulled (will auto-pull on first request)"
    fi
else
    echo "⚠️  Ollama not responding, but continuing..."
fi

# Install OpenCode skill (if OpenCode detected)
echo ""
echo "🎯 Checking for OpenCode integration..."
if command -v opencode &> /dev/null; then
    echo "✅ OpenCode detected - installing Anima skill..."
    bash scripts/install-skill.sh
else
    echo "⚠️  OpenCode not detected"
    echo "   To install Anima skill later, run: bash scripts/install-skill.sh"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Services running:"
echo "   • PostgreSQL: localhost:7101"
echo "   • API: localhost:7100 (will start when you run: bun dev)"
echo "   • Ollama: localhost:7102"
echo ""
echo "📖 Next steps:"
echo "   1. Run 'bun dev' to start the API server"
echo "   2. Visit http://localhost:7100/health to verify"
echo "   3. Check the README.md for API documentation"
echo ""
echo "🛑 To stop services: docker compose down"
echo "🗑️  To reset everything: docker compose down -v"
