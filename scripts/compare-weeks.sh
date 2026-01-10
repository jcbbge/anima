#!/usr/bin/env bash
#
# Week Comparison Tool
# Purpose: Compare Week 1 vs Week 2 performance
# Frequency: End of validation period (after Week 2)
# Output: reports/week-1-vs-2.md
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORTS_DIR="$PROJECT_DIR/reports"
OUTPUT_FILE="$REPORTS_DIR/week-1-vs-2.md"
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

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}Anima Week 1 vs Week 2 Comparison${NC}"
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

# Calculate date ranges
WEEK2_END=$DATE
WEEK2_START=$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)
WEEK1_END=$WEEK2_START
WEEK1_START=$(date -v-14d +%Y-%m-%d 2>/dev/null || date -d '14 days ago' +%Y-%m-%d)

echo "Week 1: $WEEK1_START to $WEEK1_END"
echo "Week 2: $WEEK2_START to $WEEK2_END"
echo

# Collect Week 1 metrics
echo "Collecting Week 1 metrics..."
W1_MEMORIES=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND created_at >= '$WEEK1_START' AND created_at < '$WEEK1_END';")
W1_ASSOCIATIONS=$(run_query "SELECT COUNT(*) FROM memory_associations WHERE created_at >= '$WEEK1_START' AND created_at < '$WEEK1_END';")
W1_REFLECTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$WEEK1_START' AND created_at < '$WEEK1_END';")
W1_CONTEXT=$(run_query "SELECT ROUND(AVG((metrics->>'context_quality')::numeric), 2) FROM meta_reflections WHERE created_at >= '$WEEK1_START' AND created_at < '$WEEK1_END' AND metrics->>'context_quality' IS NOT NULL;")
W1_CONTINUITY=$(run_query "SELECT ROUND(AVG((metrics->>'continuity_score')::numeric), 2) FROM meta_reflections WHERE created_at >= '$WEEK1_START' AND created_at < '$WEEK1_END' AND metrics->>'continuity_score' IS NOT NULL;")
W1_CORRECTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$WEEK1_START' AND created_at < '$WEEK1_END' AND (metrics->>'manual_corrections')::boolean = true;")

W1_CONTEXT=${W1_CONTEXT:-0}
W1_CONTINUITY=${W1_CONTINUITY:-0}

echo -e "  Memories: ${GREEN}$W1_MEMORIES${NC}"
echo -e "  Associations: ${GREEN}$W1_ASSOCIATIONS${NC}"
echo -e "  Reflections: ${GREEN}$W1_REFLECTIONS${NC}"

# Collect Week 2 metrics
echo
echo "Collecting Week 2 metrics..."
W2_MEMORIES=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND created_at >= '$WEEK2_START' AND created_at < '$WEEK2_END';")
W2_ASSOCIATIONS=$(run_query "SELECT COUNT(*) FROM memory_associations WHERE created_at >= '$WEEK2_START' AND created_at < '$WEEK2_END';")
W2_REFLECTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$WEEK2_START' AND created_at < '$WEEK2_END';")
W2_CONTEXT=$(run_query "SELECT ROUND(AVG((metrics->>'context_quality')::numeric), 2) FROM meta_reflections WHERE created_at >= '$WEEK2_START' AND created_at < '$WEEK2_END' AND metrics->>'context_quality' IS NOT NULL;")
W2_CONTINUITY=$(run_query "SELECT ROUND(AVG((metrics->>'continuity_score')::numeric), 2) FROM meta_reflections WHERE created_at >= '$WEEK2_START' AND created_at < '$WEEK2_END' AND metrics->>'continuity_score' IS NOT NULL;")
W2_CORRECTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$WEEK2_START' AND created_at < '$WEEK2_END' AND (metrics->>'manual_corrections')::boolean = true;")

W2_CONTEXT=${W2_CONTEXT:-0}
W2_CONTINUITY=${W2_CONTINUITY:-0}

echo -e "  Memories: ${GREEN}$W2_MEMORIES${NC}"
echo -e "  Associations: ${GREEN}$W2_ASSOCIATIONS${NC}"
echo -e "  Reflections: ${GREEN}$W2_REFLECTIONS${NC}"

# Calculate changes
calc_change() {
    local old=$1
    local new=$2
    if [ "$old" != "0" ] && [ "$old" != "0.00" ]; then
        awk "BEGIN {printf \"%.1f\", (($new - $old) / $old) * 100}"
    else
        echo "N/A"
    fi
}

calc_diff() {
    local old=$1
    local new=$2
    awk "BEGIN {printf \"%d\", $new - $old}"
}

# Generate comparison report
echo
echo "Generating comparison report..."

cat > "$OUTPUT_FILE" <<EOF
# Week 1 vs Week 2 Comparison

**Week 1:** $WEEK1_START to $WEEK1_END  
**Week 2:** $WEEK2_START to $WEEK2_END  
**Report Generated:** $DATE

---

## Summary

This report compares Anima V1 performance across the two-week validation period to identify learning curves, improvements, and degradations.

---

## Usage Comparison

### Conversations (Reflections)

| Metric | Week 1 | Week 2 | Change | Trend |
|--------|--------|--------|--------|-------|
| Total conversations | $W1_REFLECTIONS | $W2_REFLECTIONS | $(calc_diff $W1_REFLECTIONS $W2_REFLECTIONS) | $(if [ "$W2_REFLECTIONS" -gt "$W1_REFLECTIONS" ]; then echo "↗ Increasing"; elif [ "$W2_REFLECTIONS" -lt "$W1_REFLECTIONS" ]; then echo "↘ Decreasing"; else echo "→ Stable"; fi) |
| Daily average | $(awk "BEGIN {printf \"%.1f\", $W1_REFLECTIONS/7}") | $(awk "BEGIN {printf \"%.1f\", $W2_REFLECTIONS/7}") | $(awk "BEGIN {printf \"%+.1f\", $W2_REFLECTIONS/7 - $W1_REFLECTIONS/7}") | |

**Assessment:** $(
    W1_AVG=$(awk "BEGIN {printf \"%.0f\", $W1_REFLECTIONS/7}")
    W2_AVG=$(awk "BEGIN {printf \"%.0f\", $W2_REFLECTIONS/7}")
    if [ "$W2_AVG" -gt "$W1_AVG" ]; then
        echo "✅ Usage increased - growing engagement"
    elif [ "$W2_AVG" -eq "$W1_AVG" ]; then
        echo "→ Stable usage - consistent engagement"
    else
        echo "⚠️ Usage decreased - declining engagement"
    fi
)

---

## Memory System Comparison

### Memory Creation

| Metric | Week 1 | Week 2 | Change | Percentage Change |
|--------|--------|--------|--------|-------------------|
| New memories | $W1_MEMORIES | $W2_MEMORIES | $(calc_diff $W1_MEMORIES $W2_MEMORIES) | $(calc_change $W1_MEMORIES $W2_MEMORIES)% |
| Daily average | $(awk "BEGIN {printf \"%.1f\", $W1_MEMORIES/7}") | $(awk "BEGIN {printf \"%.1f\", $W2_MEMORIES/7}") | $(awk "BEGIN {printf \"%+.1f\", $W2_MEMORIES/7 - $W1_MEMORIES/7}") | |

**Trend:** $(if [ "$W2_MEMORIES" -gt "$W1_MEMORIES" ]; then echo "↗ Increasing"; elif [ "$W2_MEMORIES" -lt "$W1_MEMORIES" ]; then echo "↘ Decreasing"; else echo "→ Stable"; fi)

### Association Formation

| Metric | Week 1 | Week 2 | Change | Percentage Change |
|--------|--------|--------|--------|-------------------|
| New associations | $W1_ASSOCIATIONS | $W2_ASSOCIATIONS | $(calc_diff $W1_ASSOCIATIONS $W2_ASSOCIATIONS) | $(calc_change $W1_ASSOCIATIONS $W2_ASSOCIATIONS)% |
| Daily average | $(awk "BEGIN {printf \"%.1f\", $W1_ASSOCIATIONS/7}") | $(awk "BEGIN {printf \"%.1f\", $W2_ASSOCIATIONS/7}") | $(awk "BEGIN {printf \"%+.1f\", $W2_ASSOCIATIONS/7 - $W1_ASSOCIATIONS/7}") | |

**Trend:** $(if [ "$W2_ASSOCIATIONS" -gt "$W1_ASSOCIATIONS" ]; then echo "↗ Increasing"; elif [ "$W2_ASSOCIATIONS" -lt "$W1_ASSOCIATIONS" ]; then echo "↘ Decreasing"; else echo "→ Stable"; fi)

**Network Health:**
$(
    if [ "$W1_MEMORIES" -gt 0 ] && [ "$W2_MEMORIES" -gt 0 ]; then
        W1_RATIO=$(awk "BEGIN {printf \"%.2f\", $W1_ASSOCIATIONS/$W1_MEMORIES}")
        W2_RATIO=$(awk "BEGIN {printf \"%.2f\", $W2_ASSOCIATIONS/$W2_MEMORIES}")
        echo "- Week 1: $W1_RATIO associations per memory"
        echo "- Week 2: $W2_RATIO associations per memory"
        
        RATIO_CHANGE=$(awk "BEGIN {printf \"%.2f\", $W2_RATIO - $W1_RATIO}")
        if awk "BEGIN {exit !($W2_RATIO > $W1_RATIO)}"; then
            echo "- **Assessment:** ✅ Network density improving ($RATIO_CHANGE)"
        elif awk "BEGIN {exit !($W2_RATIO < $W1_RATIO)}"; then
            echo "- **Assessment:** ⚠️ Network density declining ($RATIO_CHANGE)"
        else
            echo "- **Assessment:** → Network density stable"
        fi
    else
        echo "- **Assessment:** ⏳ Insufficient data for network analysis"
    fi
)

---

## Quality Metrics Comparison

### Context Quality (Bootstrap Relevance)

| Metric | Week 1 | Week 2 | Change | Status |
|--------|--------|--------|--------|--------|
| Average score | $W1_CONTEXT/10 | $W2_CONTEXT/10 | $(awk "BEGIN {printf \"%+.2f\", $W2_CONTEXT - $W1_CONTEXT}") | $(if awk "BEGIN {exit !($W2_CONTEXT > $W1_CONTEXT)}"; then echo "↗ Improving"; elif awk "BEGIN {exit !($W2_CONTEXT < $W1_CONTEXT)}"; then echo "↘ Declining"; else echo "→ Stable"; fi) |

**Assessment:** $(
    if [ "$W1_CONTEXT" != "0" ] && [ "$W2_CONTEXT" != "0" ]; then
        if awk "BEGIN {exit !($W2_CONTEXT > $W1_CONTEXT)}"; then
            echo "✅ Context quality improved - system learning"
        elif awk "BEGIN {exit !($W2_CONTEXT < $W1_CONTEXT)}"; then
            echo "⚠️ Context quality declined - investigate cause"
        else
            echo "→ Context quality stable"
        fi
    else
        echo "⏳ Insufficient data"
    fi
)

### Thread Continuity

| Metric | Week 1 | Week 2 | Change | Status |
|--------|--------|--------|--------|--------|
| Average score | $W1_CONTINUITY/10 | $W2_CONTINUITY/10 | $(awk "BEGIN {printf \"%+.2f\", $W2_CONTINUITY - $W1_CONTINUITY}") | $(if awk "BEGIN {exit !($W2_CONTINUITY > $W1_CONTINUITY)}"; then echo "↗ Improving"; elif awk "BEGIN {exit !($W2_CONTINUITY < $W1_CONTINUITY)}"; then echo "↘ Declining"; else echo "→ Stable"; fi) |

**Assessment:** $(
    if [ "$W1_CONTINUITY" != "0" ] && [ "$W2_CONTINUITY" != "0" ]; then
        if awk "BEGIN {exit !($W2_CONTINUITY > $W1_CONTINUITY)}"; then
            echo "✅ Continuity improved - stronger threads"
        elif awk "BEGIN {exit !($W2_CONTINUITY < $W1_CONTINUITY)}"; then
            echo "⚠️ Continuity declined - weakening threads"
        else
            echo "→ Continuity stable"
        fi
    else
        echo "⏳ Insufficient data"
    fi
)

### Manual Corrections

| Metric | Week 1 | Week 2 | Change | Status |
|--------|--------|--------|--------|--------|
| Total corrections | $W1_CORRECTIONS | $W2_CORRECTIONS | $(calc_diff $W1_CORRECTIONS $W2_CORRECTIONS) | $(if [ "$W2_CORRECTIONS" -lt "$W1_CORRECTIONS" ]; then echo "↘ Improving"; elif [ "$W2_CORRECTIONS" -gt "$W1_CORRECTIONS" ]; then echo "↗ Worsening"; else echo "→ Stable"; fi) |
| Per conversation | $(if [ "$W1_REFLECTIONS" -gt 0 ]; then awk "BEGIN {printf \"%.2f\", $W1_CORRECTIONS/$W1_REFLECTIONS}"; else echo "N/A"; fi) | $(if [ "$W2_REFLECTIONS" -gt 0 ]; then awk "BEGIN {printf \"%.2f\", $W2_CORRECTIONS/$W2_REFLECTIONS}"; else echo "N/A"; fi) | $(if [ "$W1_REFLECTIONS" -gt 0 ] && [ "$W2_REFLECTIONS" -gt 0 ]; then awk "BEGIN {printf \"%+.2f\", $W2_CORRECTIONS/$W2_REFLECTIONS - $W1_CORRECTIONS/$W1_REFLECTIONS}"; else echo "N/A"; fi) | |

**Assessment:** $(
    if [ "$W1_REFLECTIONS" -gt 0 ] && [ "$W2_REFLECTIONS" -gt 0 ]; then
        W1_RATE=$(awk "BEGIN {printf \"%.2f\", $W1_CORRECTIONS/$W1_REFLECTIONS}")
        W2_RATE=$(awk "BEGIN {printf \"%.2f\", $W2_CORRECTIONS/$W2_REFLECTIONS}")
        
        if awk "BEGIN {exit !($W2_RATE < $W1_RATE)}"; then
            echo "✅ Friction decreased - system becoming smoother"
        elif awk "BEGIN {exit !($W2_RATE > $W1_RATE)}"; then
            echo "⚠️ Friction increased - more corrections needed"
        else
            echo "→ Friction stable"
        fi
    else
        echo "⏳ Insufficient data"
    fi
)

---

## Learning Curve Analysis

### Overall Trajectory

Based on the metrics above, the system is showing:

$(
    IMPROVEMENTS=0
    DECLINES=0
    
    # Check each metric
    if awk "BEGIN {exit !($W2_CONTEXT > $W1_CONTEXT)}"; then IMPROVEMENTS=$((IMPROVEMENTS + 1)); fi
    if awk "BEGIN {exit !($W2_CONTEXT < $W1_CONTEXT)}"; then DECLINES=$((DECLINES + 1)); fi
    
    if awk "BEGIN {exit !($W2_CONTINUITY > $W1_CONTINUITY)}"; then IMPROVEMENTS=$((IMPROVEMENTS + 1)); fi
    if awk "BEGIN {exit !($W2_CONTINUITY < $W1_CONTINUITY)}"; then DECLINES=$((DECLINES + 1)); fi
    
    if [ "$W2_CORRECTIONS" -lt "$W1_CORRECTIONS" ]; then IMPROVEMENTS=$((IMPROVEMENTS + 1)); fi
    if [ "$W2_CORRECTIONS" -gt "$W1_CORRECTIONS" ]; then DECLINES=$((DECLINES + 1)); fi
    
    if [ "$W2_MEMORIES" -gt "$W1_MEMORIES" ]; then IMPROVEMENTS=$((IMPROVEMENTS + 1)); fi
    if [ "$W2_MEMORIES" -lt "$W1_MEMORIES" ]; then DECLINES=$((DECLINES + 1)); fi
    
    if [ "$IMPROVEMENTS" -gt "$DECLINES" ]; then
        echo "✅ **Positive Learning Curve** - System improving over time"
        echo ""
        echo "The data shows measurable improvement from Week 1 to Week 2, indicating:"
        echo "- User becoming more proficient"
        echo "- System adapting to usage patterns"
        echo "- Memory network strengthening"
    elif [ "$DECLINES" -gt "$IMPROVEMENTS" ]; then
        echo "⚠️ **Negative Trend** - System declining over time"
        echo ""
        echo "The data shows degradation from Week 1 to Week 2, suggesting:"
        echo "- Possible engagement fatigue"
        echo "- System limitations becoming apparent"
        echo "- Need for iteration or rethinking"
    else
        echo "→ **Stable Performance** - Consistent across both weeks"
        echo ""
        echo "The data shows stable performance, indicating:"
        echo "- Consistent usage patterns"
        echo "- No major improvements or degradations"
        echo "- May need longer validation period"
    fi
)

### Key Observations

_[USER TO COMPLETE: Add qualitative observations about week-over-week changes]_

**Week 1 Characteristics:**
- [Observation 1]
- [Observation 2]

**Week 2 Characteristics:**
- [Observation 1]
- [Observation 2]

**Notable Changes:**
- [Change 1]
- [Change 2]

---

## Implications for V2

Based on week-over-week comparison:

### If Metrics Improved:
- V1 architecture is sound
- More time would yield further improvements
- V2 should build on proven foundation
- Focus V2 on addressing remaining gaps

### If Metrics Declined:
- Identify root causes of decline
- V2 may need fundamental changes
- Consider whether approach is sustainable
- Validate assumptions before proceeding

### If Metrics Stable:
- System has reached baseline performance
- V2 needed to break through plateau
- Focus V2 on step-function improvements
- Incremental V1 changes unlikely to help

---

## Recommendations

_[USER TO COMPLETE: Based on comparison data]_

1. [Recommendation 1]
2. [Recommendation 2]
3. [Recommendation 3]

---

**Report Generated By:** compare-weeks.sh  
**Timestamp:** $TIMESTAMP  
**Analysis Period:** 14 days (2 weeks)
EOF

echo -e "${GREEN}Comparison report generated!${NC}"
echo "Output: $OUTPUT_FILE"
echo
echo "Key findings:"
if [ "$W2_MEMORIES" -gt "$W1_MEMORIES" ]; then
    echo -e "  ${GREEN}✓${NC} Memory creation increased"
else
    echo -e "  ${YELLOW}!${NC} Memory creation decreased or stable"
fi

if [ "$W1_CONTEXT" != "0" ] && [ "$W2_CONTEXT" != "0" ]; then
    if awk "BEGIN {exit !($W2_CONTEXT > $W1_CONTEXT)}"; then
        echo -e "  ${GREEN}✓${NC} Context quality improved"
    else
        echo -e "  ${YELLOW}!${NC} Context quality declined or stable"
    fi
fi

if [ "$W2_CORRECTIONS" -lt "$W1_CORRECTIONS" ]; then
    echo -e "  ${GREEN}✓${NC} Fewer manual corrections needed"
else
    echo -e "  ${YELLOW}!${NC} Manual corrections increased or stable"
fi
