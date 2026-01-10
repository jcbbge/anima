#!/usr/bin/env bash
#
# Daily Metrics Collection Script
# Purpose: Collect automated system-level metrics from Anima database
# Frequency: Once per day (can be run manually or via cron)
# Output: metrics/daily/YYYY-MM-DD.json
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
METRICS_DIR="$PROJECT_DIR/metrics/daily"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

# Default values if not in .env
POSTGRES_HOST=${POSTGRES_HOST:-localhost}
POSTGRES_PORT=${POSTGRES_PORT:-7101}
POSTGRES_DB=${POSTGRES_DB:-anima}
POSTGRES_USER=${POSTGRES_USER:-anima}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-anima_dev_password}

# Create metrics directory if it doesn't exist
mkdir -p "$METRICS_DIR"

# Output file
OUTPUT_FILE="$METRICS_DIR/$DATE.json"

# Color codes for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Anima Daily Metrics Collection${NC}"
echo "Date: $DATE"
echo "Collecting metrics..."
echo

# Function to run PostgreSQL query
run_query() {
    local query="$1"
    PGPASSWORD="$POSTGRES_PASSWORD" psql \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        -t \
        -A \
        -c "$query"
}

# Collect memory count (total)
echo -n "  Total memories: "
TOTAL_MEMORIES=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL;")
echo -e "${GREEN}$TOTAL_MEMORIES${NC}"

# Collect new memories today
echo -n "  New memories today: "
NEW_MEMORIES_TODAY=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND DATE(created_at) = '$DATE';")
echo -e "${GREEN}$NEW_MEMORIES_TODAY${NC}"

# Collect tier distribution
echo "  Tier distribution:"
TIER_ACTIVE=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'active';")
TIER_THREAD=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'thread';")
TIER_STABLE=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'stable';")
TIER_NETWORK=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'network';")
echo -e "    Active: ${GREEN}$TIER_ACTIVE${NC}"
echo -e "    Thread: ${GREEN}$TIER_THREAD${NC}"
echo -e "    Stable: ${GREEN}$TIER_STABLE${NC}"
echo -e "    Network: ${GREEN}$TIER_NETWORK${NC}"

# Collect association count
echo -n "  Total associations: "
TOTAL_ASSOCIATIONS=$(run_query "SELECT COUNT(*) FROM memory_associations;")
echo -e "${GREEN}$TOTAL_ASSOCIATIONS${NC}"

# Collect new associations today
echo -n "  New associations today: "
NEW_ASSOCIATIONS_TODAY=$(run_query "SELECT COUNT(*) FROM memory_associations WHERE DATE(created_at) = '$DATE';")
echo -e "${GREEN}$NEW_ASSOCIATIONS_TODAY${NC}"

# Collect top categories
echo "  Top 5 categories:"
TOP_CATEGORIES=$(run_query "SELECT category, COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 5;")
if [ -n "$TOP_CATEGORIES" ]; then
    echo "$TOP_CATEGORIES" | while IFS='|' read -r category count; do
        echo -e "    ${category}: ${GREEN}${count}${NC}"
    done
else
    echo "    (No categorized memories)"
fi

# Collect recent reflections (if any from today)
echo -n "  Reflections today: "
REFLECTIONS_TODAY=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE DATE(created_at) = '$DATE';")
echo -e "${GREEN}$REFLECTIONS_TODAY${NC}"

# Get latest reflection metrics if exists
LATEST_REFLECTION=""
if [ "$REFLECTIONS_TODAY" -gt 0 ]; then
    LATEST_REFLECTION=$(run_query "SELECT metrics FROM meta_reflections WHERE DATE(created_at) = '$DATE' ORDER BY created_at DESC LIMIT 1;")
fi

# Calculate growth rate (memories per day over last 7 days)
echo -n "  7-day avg growth rate: "
SEVEN_DAY_GROWTH=$(run_query "SELECT ROUND(COUNT(*)::numeric / 7, 2) FROM memories WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '7 days';")
echo -e "${GREEN}$SEVEN_DAY_GROWTH${NC} memories/day"

# Build JSON output
cat > "$OUTPUT_FILE" <<EOF
{
  "date": "$DATE",
  "timestamp": "$TIMESTAMP",
  "metrics": {
    "memories": {
      "total": $TOTAL_MEMORIES,
      "new_today": $NEW_MEMORIES_TODAY,
      "seven_day_avg_growth": $SEVEN_DAY_GROWTH,
      "tier_distribution": {
        "active": $TIER_ACTIVE,
        "thread": $TIER_THREAD,
        "stable": $TIER_STABLE,
        "network": $TIER_NETWORK
      }
    },
    "associations": {
      "total": $TOTAL_ASSOCIATIONS,
      "new_today": $NEW_ASSOCIATIONS_TODAY
    },
    "reflections": {
      "count_today": $REFLECTIONS_TODAY,
      "latest": $LATEST_REFLECTION
    }
  }
}
EOF

echo
echo -e "${GREEN}Metrics collected successfully!${NC}"
echo "Output: $OUTPUT_FILE"
echo

# Display warning if no activity today
if [ "$NEW_MEMORIES_TODAY" -eq 0 ] && [ "$REFLECTIONS_TODAY" -eq 0 ]; then
    echo -e "${BLUE}Note: No new memories or reflections recorded today.${NC}"
    echo "This may indicate Anima was not used today."
fi
