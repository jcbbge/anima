#!/bin/bash
# Anima Health Monitor — Quick diagnostic for Anima MCP server issues

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Anima Health Check ==="
echo "Timestamp: $(date)"
echo ""

# Check if Anima is running
echo -n "Anima process: "
ANIMA_PID=$(lsof -ti:3098 2>/dev/null || echo "")
if [ -n "$ANIMA_PID" ]; then
    echo -e "${GREEN}OK${NC} (PID: $ANIMA_PID)"
    # Show uptime
    ps -o etime= -p $ANIMA_PID 2>/dev/null | xargs echo "  Uptime:"
else
    echo -e "${RED}NOT RUNNING${NC}"
fi

# Health endpoint
echo -n "Health endpoint: "
HEALTH=$(curl -sf http://localhost:3098/health 2>&1 || echo "FAIL")
if [ "$HEALTH" = "FAIL" ]; then
    echo -e "${RED}FAIL${NC}"
else
    echo -e "${GREEN}OK${NC} $HEALTH"
fi

# Check Ollama (needed for embeddings)
echo -n "Ollama service: "
OLLAMA=$(curl -sf http://localhost:11434/api/tags 2>&1 | head -1 || echo "FAIL")
if [ "$OLLAMA" = "FAIL" ]; then
    echo -e "${RED}DOWN${NC} (embeddings will fail - start with: ollama serve)"
else
    MODELS=$(echo "$OLLAMA" | grep -c "name" 2>/dev/null || echo "0")
    echo -e "${GREEN}OK${NC} ($MODELS models available)"
fi

# Check SurrealDB
echo -n "SurrealDB connection: "
SURREAL=$(lsof -ti:8002 2>/dev/null || echo "")
if [ -n "$SURREAL" ]; then
    echo -e "${GREEN}OK${NC} (PID: $SURREAL)"
else
    echo -e "${RED}DOWN${NC}"
fi

# Check recent restarts by looking at log
echo ""
echo "=== Recent Activity ==="
LOG_FILE="$HOME/.anima/anima-mcp.log"
if [ -f "$LOG_FILE" ]; then
    # Count restarts in last 10 minutes
    RESTARTS=$(grep -c "Starting HTTP MCP server" "$LOG_FILE" 2>/dev/null || echo "0")
    RECENT=$(grep "Starting HTTP MCP server" "$LOG_FILE" 2>/dev/null | tail -5 | wc -l | xargs)
    echo "Total restarts in log: $RESTARTS"
    echo "Recent 'Starting HTTP MCP server' entries (last 5):"
    grep "Starting HTTP MCP server" "$LOG_FILE" 2>/dev/null | tail -5 | while read line; do
        echo "  - $line"
    done

    # Check for errors
    ERRORS=$(grep -c "error\|Error\|ERROR\|fail\|Fail\|FAIL" "$LOG_FILE" 2>/dev/null || echo "0")
    echo ""
    echo -n "Total errors in log: "
    if [ "$ERRORS" -gt 0 ]; then
        echo -e "${YELLOW}$ERRORS${NC}"
        echo "Last 3 errors:"
        grep -i "error\|Error\|ERROR" "$LOG_FILE" 2>/dev/null | tail -3 | while read line; do
            echo "  $line"
        done
    else
        echo -e "${GREEN}0${NC}"
    fi
else
    echo "Log file not found at $LOG_FILE"
fi

# Memory usage
echo ""
echo "=== Memory Usage ==="
ps aux | grep -E "(anima|deno.*anima)" | grep -v grep | awk '{print "Anima: " $6/1024 " MB RSS"}' || echo "Anima not running"
ps aux | grep surreal | grep -v grep | awk '{print "SurrealDB: " $6/1024 " MB RSS"}' || echo "SurrealDB not running"

echo ""
echo "=== Quick Actions ==="
echo "  Restart Anima:  launchctl stop dev.brain.anima-mcp && sleep 2 && launchctl start dev.brain.anima-mcp"
echo "  Restart All:    launchctl stop dev.brain.anima-mcp; launchctl stop dev.brain.surreal; sleep 2; launchctl start dev.brain.surreal; sleep 5; launchctl start dev.brain.anima-mcp"
echo "  View logs:      tail -f ~/.anima/anima-mcp.log"
echo "  Start Ollama:   ollama serve"
echo ""
