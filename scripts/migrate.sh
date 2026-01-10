#!/usr/bin/env bash
set -e

echo "🔄 Running Anima database migrations..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker."
    exit 1
fi

# Check if postgres container is running
if ! docker compose ps postgres | grep -q "Up"; then
    echo "❌ PostgreSQL container is not running."
    echo "   Run: docker compose up -d postgres"
    exit 1
fi

# Find all migration files in order
MIGRATIONS_DIR="database/migrations"
MIGRATION_FILES=$(ls -1 $MIGRATIONS_DIR/*.sql 2>/dev/null | sort)

if [ -z "$MIGRATION_FILES" ]; then
    echo "❌ No migration files found in $MIGRATIONS_DIR"
    exit 1
fi

echo "📋 Found migrations:"
for file in $MIGRATION_FILES; do
    echo "   - $(basename $file)"
done
echo ""

# Run each migration
for migration_file in $MIGRATION_FILES; do
    migration_name=$(basename $migration_file)
    echo "⚙️  Running: $migration_name"
    
    if docker compose exec -T postgres psql -U anima -d anima -f - < "$migration_file" > /dev/null 2>&1; then
        echo "✅ Success: $migration_name"
    else
        # Migration might have already been run, check for specific errors
        if docker compose exec -T postgres psql -U anima -d anima -f - < "$migration_file" 2>&1 | grep -q "already exists"; then
            echo "⏭️  Skipped: $migration_name (already applied)"
        else
            echo "❌ Failed: $migration_name"
            echo ""
            echo "Error details:"
            docker compose exec -T postgres psql -U anima -d anima -f - < "$migration_file"
            exit 1
        fi
    fi
done

echo ""
echo "✅ All migrations completed!"
echo ""

# Verify schema
echo "📊 Database schema verification:"
docker compose exec -T postgres psql -U anima -d anima -c "\dt"
echo ""
