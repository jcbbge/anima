#!/usr/bin/env bash
#
# Weekly Trends Analysis Script
# Purpose: Analyze trends across week's data
# Frequency: Weekly (Sunday evening or end of week)
# Output: reports/week-N.md with trend analysis
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
METRICS_DIR="$PROJECT_DIR/metrics/daily"
REPORTS_DIR="$PROJECT_DIR/reports"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

# Default values
POSTGRES_HOST=${POSTGRES_HOST:-localhost}
POSTGRES_PORT=${POSTGRES_PORT:-7101}
POSTGRES_DB=${POSTGRES_DB:-anima}
POSTGRES_USER=${POSTGRES_USER:-anima}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-anima_dev_password}

# Create reports directory if it doesn't exist
mkdir -p "$REPORTS_DIR"

# Determine week number
WEEK_NUM=$(ls -1 "$REPORTS_DIR"/week-*.md 2>/dev/null | wc -l | tr -d ' ')
WEEK_NUM=$((WEEK_NUM + 1))
OUTPUT_FILE="$REPORTS_DIR/week-$WEEK_NUM.md"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Anima Weekly Trends Analysis${NC}"
echo "Week: $WEEK_NUM"
echo "Date: $DATE"
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

# Calculate date range (last 7 days)
START_DATE=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)
END_DATE=$DATE

echo "Analyzing period: $START_DATE to $END_DATE"
echo

# Collect weekly metrics
echo "Collecting weekly metrics..."

# Memory growth this week
NEW_MEMORIES_WEEK=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND created_at >= '$START_DATE' AND created_at < '$END_DATE';")
echo -e "  New memories: ${GREEN}$NEW_MEMORIES_WEEK${NC}"

# New associations this week
NEW_ASSOCIATIONS_WEEK=$(run_query "SELECT COUNT(*) FROM memory_associations WHERE created_at >= '$START_DATE' AND created_at < '$END_DATE';")
echo -e "  New associations: ${GREEN}$NEW_ASSOCIATIONS_WEEK${NC}"

# Reflections this week (from meta_reflections)
REFLECTIONS_WEEK=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$START_DATE' AND created_at < '$END_DATE';")
echo -e "  Reflections: ${GREEN}$REFLECTIONS_WEEK${NC}"

# Get daily metrics from JSON files (if they exist)
DAILY_FILES_COUNT=0
CONTEXT_QUALITY_SUM=0
CONTEXT_QUALITY_COUNT=0
CONTINUITY_SUM=0
CONTINUITY_COUNT=0

echo
echo "Processing daily metrics files..."
for i in {0..6}; do
    CHECK_DATE=$(date -v-${i}d +%Y-%m-%d 2>/dev/null || date -d "$i days ago" +%Y-%m-%d)
    DAILY_FILE="$METRICS_DIR/$CHECK_DATE.json"
    
    if [ -f "$DAILY_FILE" ]; then
        DAILY_FILES_COUNT=$((DAILY_FILES_COUNT + 1))
    fi
done

echo -e "  Daily metric files found: ${GREEN}$DAILY_FILES_COUNT${NC}/7"

# Calculate average metrics from reflections
AVG_CONTEXT_QUALITY=$(run_query "SELECT ROUND(AVG((metrics->>'context_quality')::numeric), 2) FROM meta_reflections WHERE created_at >= '$START_DATE' AND created_at < '$END_DATE' AND metrics->>'context_quality' IS NOT NULL;")
AVG_CONTINUITY=$(run_query "SELECT ROUND(AVG((metrics->>'continuity_score')::numeric), 2) FROM meta_reflections WHERE created_at >= '$START_DATE' AND created_at < '$END_DATE' AND metrics->>'continuity_score' IS NOT NULL;")
MANUAL_INTERVENTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$START_DATE' AND created_at < '$END_DATE' AND (metrics->>'manual_corrections')::boolean = true;")

# Default to 'N/A' if no data
AVG_CONTEXT_QUALITY=${AVG_CONTEXT_QUALITY:-N/A}
AVG_CONTINUITY=${AVG_CONTINUITY:-N/A}

echo
echo "Key metrics this week:"
echo -e "  Avg context quality: ${GREEN}$AVG_CONTEXT_QUALITY${NC}/10"
echo -e "  Avg continuity score: ${GREEN}$AVG_CONTINUITY${NC}/10"
echo -e "  Manual interventions: ${GREEN}$MANUAL_INTERVENTIONS${NC}"

# Determine trends
echo
echo "Analyzing trends..."

# Memory growth trend
if [ "$WEEK_NUM" -gt 1 ]; then
    PREV_WEEK=$((WEEK_NUM - 1))
    PREV_START=$(date -v-14d +%Y-%m-%d 2>/dev/null || date -d '14 days ago' +%Y-%m-%d)
    PREV_END=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)
    
    PREV_MEMORIES=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND created_at >= '$PREV_START' AND created_at < '$PREV_END';")
    
    if [ "$NEW_MEMORIES_WEEK" -gt "$PREV_MEMORIES" ]; then
        MEMORY_TREND="↗ Increasing"
    elif [ "$NEW_MEMORIES_WEEK" -lt "$PREV_MEMORIES" ]; then
        MEMORY_TREND="↘ Decreasing"
    else
        MEMORY_TREND="→ Stable"
    fi
else
    MEMORY_TREND="→ Baseline (first week)"
fi

echo -e "  Memory growth: ${YELLOW}$MEMORY_TREND${NC}"

# Generate markdown report
echo
echo "Generating report..."

cat > "$OUTPUT_FILE" <<EOF
# Anima Validation - Week $WEEK_NUM Report

**Date Range:** $START_DATE to $END_DATE  
**Generated:** $DATE  
**Report Type:** Weekly Trends Analysis

---

## Summary

This report analyzes Anima V1 usage patterns and metrics for Week $WEEK_NUM.

**Key Statistics:**
- Conversations/Reflections: $REFLECTIONS_WEEK
- New memories created: $NEW_MEMORIES_WEEK
- New associations formed: $NEW_ASSOCIATIONS_WEEK
- Daily metrics captured: $DAILY_FILES_COUNT/7 days

---

## Quantitative Metrics

### Context Quality
- **Average score:** $AVG_CONTEXT_QUALITY/10
- **Threshold:** Good ≥7.0
- **Assessment:** $([ "$AVG_CONTEXT_QUALITY" != "N/A" ] && awk "BEGIN {if ($AVG_CONTEXT_QUALITY >= 7.0) print \"✅ Good\"; else if ($AVG_CONTEXT_QUALITY >= 6.0) print \"⚠️ Acceptable\"; else print \"❌ Needs improvement\"}" || echo "⏳ Insufficient data")

### Thread Continuity
- **Average score:** $AVG_CONTINUITY/10
- **Threshold:** Good ≥7.0
- **Assessment:** $([ "$AVG_CONTINUITY" != "N/A" ] && awk "BEGIN {if ($AVG_CONTINUITY >= 7.0) print \"✅ Good\"; else if ($AVG_CONTINUITY >= 5.0) print \"⚠️ Acceptable\"; else print \"❌ Needs improvement\"}" || echo "⏳ Insufficient data")

### Manual Interventions
- **Count:** $MANUAL_INTERVENTIONS
- **Threshold:** Good <$REFLECTIONS_WEEK interactions (ratio <1.0)
- **Assessment:** $(if [ "$REFLECTIONS_WEEK" -gt 0 ]; then awk "BEGIN {if ($MANUAL_INTERVENTIONS < $REFLECTIONS_WEEK) print \"✅ Low friction\"; else print \"⚠️ High friction\"}"; else echo "⏳ No data"; fi)

---

## System Health

### Memory Growth
- **New memories this week:** $NEW_MEMORIES_WEEK
- **Trend:** $MEMORY_TREND
- **Daily average:** $(awk "BEGIN {printf \"%.1f\", $NEW_MEMORIES_WEEK/7}") memories/day
- **Assessment:** $(if [ "$NEW_MEMORIES_WEEK" -ge 35 ]; then echo "✅ Active usage"; elif [ "$NEW_MEMORIES_WEEK" -ge 14 ]; then echo "⚠️ Moderate usage"; else echo "❌ Low usage"; fi)

### Association Network
- **New associations this week:** $NEW_ASSOCIATIONS_WEEK
- **Daily average:** $(awk "BEGIN {printf \"%.1f\", $NEW_ASSOCIATIONS_WEEK/7}") associations/day
- **Assessment:** $(if [ "$NEW_ASSOCIATIONS_WEEK" -ge 14 ]; then echo "✅ Network growing"; elif [ "$NEW_ASSOCIATIONS_WEEK" -ge 7 ]; then echo "⚠️ Slow growth"; else echo "❌ Sparse network"; fi)

### Data Completeness
- **Daily metrics captured:** $DAILY_FILES_COUNT/7 days
- **Assessment:** $(if [ "$DAILY_FILES_COUNT" -ge 6 ]; then echo "✅ Complete"; elif [ "$DAILY_FILES_COUNT" -ge 4 ]; then echo "⚠️ Mostly complete"; else echo "❌ Incomplete"; fi)

---

## Trend Analysis

### Memory Growth Pattern
$MEMORY_TREND

$(if [ "$WEEK_NUM" -gt 1 ]; then
    echo "**Week $PREV_WEEK:** $PREV_MEMORIES memories"
    echo "**Week $WEEK_NUM:** $NEW_MEMORIES_WEEK memories"
    echo "**Change:** $((NEW_MEMORIES_WEEK - PREV_MEMORIES)) memories ($( [ "$NEW_MEMORIES_WEEK" -gt "$PREV_MEMORIES" ] && echo "+" || echo "" )$(awk "BEGIN {if ($PREV_MEMORIES > 0) printf \"%.1f%%\", (($NEW_MEMORIES_WEEK - $PREV_MEMORIES) / $PREV_MEMORIES * 100); else print \"N/A\"}"))"
else
    echo "Baseline week - no comparison available."
fi)

---

## Notes for Manual Reflection

Use this section to add qualitative observations from USAGE_JOURNAL.md:

### Highlights
- [What went really well this week?]
- [Any surprising observations?]

### Lowlights
- [What struggled this week?]
- [Any repeated friction points?]

### Patterns Noticed
- [Emerging patterns in usage?]
- [Specific scenarios that work well/poorly?]

### Questions Raised
- [What are you wondering about?]
- [What seems unclear?]

### Changes to Try Next Week
- [Adjustments to make]
- [Experiments to run]

---

## Action Items

Based on this week's data:

- [ ] Review USAGE_JOURNAL.md entries for qualitative patterns
- [ ] Compare metrics to thresholds (see TESTING_FRAMEWORK.md)
- [ ] Identify any critical gaps or issues
- [ ] Plan any adjustments for next week

$(if [ "$WEEK_NUM" -eq 2 ]; then
    echo "- [ ] **Week 2 complete!** Run bi-weekly analysis: \`./scripts/synthesis-report.sh\`"
    echo "- [ ] **Week 2 complete!** Compare weeks: \`./scripts/compare-weeks.sh\`"
    echo "- [ ] **Week 2 complete!** Complete GAP_ANALYSIS.md"
    echo "- [ ] **Week 2 complete!** Generate V2_REQUIREMENTS.md"
fi)

---

**Report generated by:** weekly-trends.sh  
**Timestamp:** $TIMESTAMP
EOF

echo -e "${GREEN}Weekly report generated!${NC}"
echo "Output: $OUTPUT_FILE"
echo
echo "Next steps:"
echo "  1. Review the report: $OUTPUT_FILE"
echo "  2. Add manual reflections to the 'Notes' section"
echo "  3. Update WEEKLY_REFLECTIONS.md with observations"

if [ "$WEEK_NUM" -eq 2 ]; then
    echo
    echo -e "${YELLOW}Week 2 complete! Time for comprehensive analysis:${NC}"
    echo "  - Run: ./scripts/synthesis-report.sh"
    echo "  - Run: ./scripts/compare-weeks.sh"
    echo "  - Complete GAP_ANALYSIS.md"
fi
