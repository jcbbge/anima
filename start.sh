#!/usr/bin/env bash
set -e

echo "🚀 Starting Anima V1 API Server..."

# Kill anything on port 7100
PORT=${PORT:-7100}
echo "   Checking port $PORT..."

if lsof -ti :$PORT > /dev/null 2>&1; then
    echo "   Killing process on port $PORT..."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Start the server
echo "   Starting server on port $PORT..."
exec bun run src/server.js
