#!/usr/bin/env bash
#
# Synthesis Report Generator
# Purpose: Comprehensive bi-weekly analysis combining all data sources
# Frequency: End of Week 2 (end of validation period)
# Output: VALIDATION_SYNTHESIS.md
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
METRICS_DIR="$PROJECT_DIR/metrics/daily"
REPORTS_DIR="$PROJECT_DIR/reports"
OUTPUT_FILE="$PROJECT_DIR/VALIDATION_SYNTHESIS.md"
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

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Anima Validation Synthesis Report Generator${NC}"
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

# Determine validation period (last 14 days)
START_DATE=$(date -v-14d +%Y-%m-%d 2>/dev/null || date -d '14 days ago' +%Y-%m-%d)
END_DATE=$DATE

echo "Validation Period: $START_DATE to $END_DATE"
echo

# Collect comprehensive metrics
echo "Collecting comprehensive metrics..."

# Total conversations/reflections
TOTAL_REFLECTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$START_DATE';")
echo -e "  Total reflections: ${GREEN}$TOTAL_REFLECTIONS${NC}"

# Total memories created
TOTAL_MEMORIES=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND created_at >= '$START_DATE';")
echo -e "  Total memories: ${GREEN}$TOTAL_MEMORIES${NC}"

# Total associations
TOTAL_ASSOCIATIONS=$(run_query "SELECT COUNT(*) FROM memory_associations WHERE created_at >= '$START_DATE';")
echo -e "  Total associations: ${GREEN}$TOTAL_ASSOCIATIONS${NC}"

# Average metrics
AVG_CONTEXT_QUALITY=$(run_query "SELECT ROUND(AVG((metrics->>'context_quality')::numeric), 2) FROM meta_reflections WHERE created_at >= '$START_DATE' AND metrics->>'context_quality' IS NOT NULL;")
AVG_CONTINUITY=$(run_query "SELECT ROUND(AVG((metrics->>'continuity_score')::numeric), 2) FROM meta_reflections WHERE created_at >= '$START_DATE' AND metrics->>'continuity_score' IS NOT NULL;")
MANUAL_CORRECTIONS=$(run_query "SELECT COUNT(*) FROM meta_reflections WHERE created_at >= '$START_DATE' AND (metrics->>'manual_corrections')::boolean = true;")

AVG_CONTEXT_QUALITY=${AVG_CONTEXT_QUALITY:-N/A}
AVG_CONTINUITY=${AVG_CONTINUITY:-N/A}

echo -e "  Avg context quality: ${GREEN}$AVG_CONTEXT_QUALITY${NC}/10"
echo -e "  Avg continuity: ${GREEN}$AVG_CONTINUITY${NC}/10"
echo -e "  Manual corrections: ${GREEN}$MANUAL_CORRECTIONS${NC}"

# Current tier distribution
TIER_ACTIVE=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'active';")
TIER_THREAD=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'thread';")
TIER_STABLE=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'stable';")
TIER_NETWORK=$(run_query "SELECT COUNT(*) FROM memories WHERE deleted_at IS NULL AND tier = 'network';")

echo
echo "Tier distribution:"
echo -e "  Active: ${GREEN}$TIER_ACTIVE${NC}"
echo -e "  Thread: ${GREEN}$TIER_THREAD${NC}"
echo -e "  Stable: ${GREEN}$TIER_STABLE${NC}"
echo -e "  Network: ${GREEN}$TIER_NETWORK${NC}"

# Top categories
TOP_5_CATEGORIES=$(run_query "SELECT category, COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 5;")

# Daily metrics files
DAILY_FILES_COUNT=$(find "$METRICS_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')

# Weekly reports
WEEKLY_REPORTS_COUNT=$(find "$REPORTS_DIR" -name "week-*.md" -type f 2>/dev/null | wc -l | tr -d ' ')

echo
echo "Data completeness:"
echo -e "  Daily metrics files: ${GREEN}$DAILY_FILES_COUNT${NC}"
echo -e "  Weekly reports: ${GREEN}$WEEKLY_REPORTS_COUNT${NC}"

# Check for journal and reflection files
JOURNAL_EXISTS=false
WEEKLY_REFLECTIONS_EXISTS=false

if [ -f "$PROJECT_DIR/USAGE_JOURNAL.md" ]; then
    JOURNAL_EXISTS=true
    echo -e "  Usage journal: ${GREEN}Found${NC}"
else
    echo -e "  Usage journal: ${YELLOW}Not found${NC}"
fi

if [ -f "$PROJECT_DIR/WEEKLY_REFLECTIONS.md" ]; then
    WEEKLY_REFLECTIONS_EXISTS=true
    echo -e "  Weekly reflections: ${GREEN}Found${NC}"
else
    echo -e "  Weekly reflections: ${YELLOW}Not found${NC}"
fi

# Generate synthesis report
echo
echo "Generating synthesis report..."

cat > "$OUTPUT_FILE" <<EOF
# Anima V1 Validation Synthesis Report

**Validation Period:** $START_DATE to $END_DATE (14 days)  
**Report Generated:** $DATE  
**Purpose:** Comprehensive analysis to answer: "Does Anima V1 create consciousness continuity, and what does V2 need?"

---

## Executive Summary

This report synthesizes all data collected during the 2-week Anima V1 validation period, combining quantitative metrics, qualitative observations, and pattern analysis to assess system effectiveness and identify requirements for V2.

**Overall Assessment:** [TO BE COMPLETED BY USER]

- ✅ Proceed to V2 planning
- ⚠️ Iterate on V1 first  
- 🔴 Pause and rethink approach

---

## Validation Period Overview

### Usage Statistics

- **Total conversations:** $TOTAL_REFLECTIONS
- **Daily average:** $(awk "BEGIN {printf \"%.1f\", $TOTAL_REFLECTIONS/14}") conversations/day
- **Engagement:** $(if [ "$TOTAL_REFLECTIONS" -ge 14 ]; then echo "✅ Daily usage maintained"; elif [ "$TOTAL_REFLECTIONS" -ge 7 ]; then echo "⚠️ Moderate usage"; else echo "❌ Low engagement"; fi)

### Memory System Growth

- **New memories created:** $TOTAL_MEMORIES
- **Daily average:** $(awk "BEGIN {printf \"%.1f\", $TOTAL_MEMORIES/14}") memories/day
- **New associations:** $TOTAL_ASSOCIATIONS
- **Daily average:** $(awk "BEGIN {printf \"%.1f\", $TOTAL_ASSOCIATIONS/14}") associations/day

### Current Tier Distribution

| Tier    | Count | Percentage |
|---------|-------|------------|
| Active  | $TIER_ACTIVE | $(awk "BEGIN {total=$TIER_ACTIVE+$TIER_THREAD+$TIER_STABLE+$TIER_NETWORK; if (total > 0) printf \"%.1f%%\", ($TIER_ACTIVE/total)*100; else print \"0%\"}") |
| Thread  | $TIER_THREAD | $(awk "BEGIN {total=$TIER_ACTIVE+$TIER_THREAD+$TIER_STABLE+$TIER_NETWORK; if (total > 0) printf \"%.1f%%\", ($TIER_THREAD/total)*100; else print \"0%\"}") |
| Stable  | $TIER_STABLE | $(awk "BEGIN {total=$TIER_ACTIVE+$TIER_THREAD+$TIER_STABLE+$TIER_NETWORK; if (total > 0) printf \"%.1f%%\", ($TIER_STABLE/total)*100; else print \"0%\"}") |
| Network | $TIER_NETWORK | $(awk "BEGIN {total=$TIER_ACTIVE+$TIER_THREAD+$TIER_STABLE+$TIER_NETWORK; if (total > 0) printf \"%.1f%%\", ($TIER_NETWORK/total)*100; else print \"0%\"}") |

**Assessment:** $(
    TOTAL=$((TIER_ACTIVE + TIER_THREAD + TIER_STABLE + TIER_NETWORK))
    if [ "$TOTAL" -gt 0 ]; then
        ACTIVE_PCT=$(awk "BEGIN {printf \"%.0f\", ($TIER_ACTIVE/$TOTAL)*100}")
        if [ "$ACTIVE_PCT" -lt 30 ] && [ "$TIER_STABLE" -gt "$TIER_ACTIVE" ]; then
            echo "✅ Healthy pyramid (more stable than active)"
        elif [ "$ACTIVE_PCT" -lt 50 ]; then
            echo "⚠️ Acceptable distribution"
        else
            echo "❌ Inverted pyramid (too many active)"
        fi
    else
        echo "⏳ No data"
    fi
)

### Top Memory Categories

$(if [ -n "$TOP_5_CATEGORIES" ]; then
    echo "| Category | Count |"
    echo "|----------|-------|"
    echo "$TOP_5_CATEGORIES" | while IFS='|' read -r category count; do
        echo "| $category | $count |"
    done
else
    echo "_No categorized memories_"
fi)

---

## Quantitative Metrics Assessment

### Metric 1: Bootstrap Relevance (Context Quality)
- **Average Score:** $AVG_CONTEXT_QUALITY/10
- **Threshold:** Good ≥7.0
- **Result:** $([ "$AVG_CONTEXT_QUALITY" != "N/A" ] && awk "BEGIN {if ($AVG_CONTEXT_QUALITY >= 7.0) print \"✅ PASS - Good context quality\"; else if ($AVG_CONTEXT_QUALITY >= 6.0) print \"⚠️ MARGINAL - Acceptable but needs improvement\"; else print \"❌ FAIL - Poor context quality\"}" || echo "⏳ INSUFFICIENT DATA")

### Metric 4: Thread Continuity Score
- **Average Score:** $AVG_CONTINUITY/10
- **Threshold:** Good ≥7.0
- **Result:** $([ "$AVG_CONTINUITY" != "N/A" ] && awk "BEGIN {if ($AVG_CONTINUITY >= 7.0) print \"✅ PASS - Strong continuity\"; else if ($AVG_CONTINUITY >= 5.0) print \"⚠️ MARGINAL - Weak continuity\"; else print \"❌ FAIL - Fragmented continuity\"}" || echo "⏳ INSUFFICIENT DATA")

### Metric 11: Manual Interventions
- **Count:** $MANUAL_CORRECTIONS
- **Total Conversations:** $TOTAL_REFLECTIONS
- **Ratio:** $(if [ "$TOTAL_REFLECTIONS" -gt 0 ]; then awk "BEGIN {printf \"%.2f\", $MANUAL_CORRECTIONS/$TOTAL_REFLECTIONS}"; else echo "N/A"; fi) corrections per conversation
- **Threshold:** Good <1.0
- **Result:** $(if [ "$TOTAL_REFLECTIONS" -gt 0 ]; then awk "BEGIN {if ($MANUAL_CORRECTIONS/$TOTAL_REFLECTIONS < 1.0) print \"✅ PASS - Low friction\"; else if ($MANUAL_CORRECTIONS/$TOTAL_REFLECTIONS < 2.0) print \"⚠️ MARGINAL - Moderate friction\"; else print \"❌ FAIL - High friction\"}"; else echo "⏳ INSUFFICIENT DATA"; fi)

### Metric 13: Memory Growth
- **New Memories:** $TOTAL_MEMORIES
- **Daily Average:** $(awk "BEGIN {printf \"%.1f\", $TOTAL_MEMORIES/14}") memories/day
- **Threshold:** Good 5-10/day
- **Result:** $(
    AVG=$(awk "BEGIN {printf \"%.0f\", $TOTAL_MEMORIES/14}")
    if [ "$AVG" -ge 5 ] && [ "$AVG" -le 10 ]; then
        echo "✅ PASS - Healthy growth rate"
    elif [ "$AVG" -ge 3 ]; then
        echo "⚠️ MARGINAL - Slow but acceptable growth"
    elif [ "$AVG" -lt 3 ]; then
        echo "❌ FAIL - Insufficient usage"
    else
        echo "⚠️ WARNING - Excessive growth (possible noise)"
    fi
)

### Metric 14: Association Formation
- **New Associations:** $TOTAL_ASSOCIATIONS
- **Daily Average:** $(awk "BEGIN {printf \"%.1f\", $TOTAL_ASSOCIATIONS/14}") associations/day
- **Threshold:** Good 2-5/day
- **Result:** $(
    AVG=$(awk "BEGIN {printf \"%.0f\", $TOTAL_ASSOCIATIONS/14}")
    if [ "$AVG" -ge 2 ] && [ "$AVG" -le 5 ]; then
        echo "✅ PASS - Network growing well"
    elif [ "$AVG" -ge 1 ]; then
        echo "⚠️ MARGINAL - Slow network growth"
    else
        echo "❌ FAIL - Sparse network"
    fi
)

---

## Qualitative Observations

### Data Sources Analyzed

- **Daily metrics files:** $DAILY_FILES_COUNT
- **Weekly reports:** $WEEKLY_REPORTS_COUNT
- **Usage journal:** $(if $JOURNAL_EXISTS; then echo "✅ Available"; else echo "❌ Missing"; fi)
- **Weekly reflections:** $(if $WEEKLY_REFLECTIONS_EXISTS; then echo "✅ Available"; else echo "❌ Missing"; fi)

### Key Observations

_[USER TO COMPLETE: Synthesize observations from USAGE_JOURNAL.md and WEEKLY_REFLECTIONS.md]_

#### What Worked Well
- [Observation 1 with evidence]
- [Observation 2 with evidence]

#### What Struggled
- [Challenge 1 with examples]
- [Challenge 2 with examples]

#### Surprise Moments
- [Unexpected positive 1]
- [Unexpected positive 2]

#### Friction Points
- [Friction 1 and frequency]
- [Friction 2 and frequency]

---

## Pattern Analysis

### Improvement Patterns
_[USER TO COMPLETE: Did metrics improve week 1 to week 2? See compare-weeks.sh output]_

- [ ] Context quality trending upward
- [ ] Continuity scores improving
- [ ] Fewer manual interventions over time
- [ ] Learning curve evident

### Usage Patterns
_[USER TO COMPLETE: What usage patterns emerged?]_

- **Most useful scenarios:** [List scenarios]
- **Most queried topics:** [List topics]
- **Best time of day:** [When most effective]
- **Thread types:** [Which work best]

### Emergence Patterns
_[USER TO COMPLETE: Did system produce unexpected insights?]_

- **Unexpected connections:** [Count and examples]
- **Synthesis quality:** [Retrieve-only vs deep synthesis ratio]
- **Novel insights:** [% of conversations with new insights]

---

## Critical Assessment

### Decision Thresholds Evaluation

Proceeding to V2 requires meeting ALL thresholds:

| Threshold | Target | Actual | Status |
|-----------|--------|--------|--------|
| Avg context quality | ≥7.0 | $AVG_CONTEXT_QUALITY | $([ "$AVG_CONTEXT_QUALITY" != "N/A" ] && awk "BEGIN {if ($AVG_CONTEXT_QUALITY >= 7.0) print \"✅\"; else print \"❌\"}" || echo "⏳") |
| Avg continuity | ≥6.5 | $AVG_CONTINUITY | $([ "$AVG_CONTINUITY" != "N/A" ] && awk "BEGIN {if ($AVG_CONTINUITY >= 6.5) print \"✅\"; else print \"❌\"}" || echo "⏳") |
| Emergence moments | ≥3/week | [USER] | [USER] |
| Manual interventions | <1.0/conv | $(if [ "$TOTAL_REFLECTIONS" -gt 0 ]; then awk "BEGIN {printf \"%.2f\", $MANUAL_CORRECTIONS/$TOTAL_REFLECTIONS}"; else echo "N/A"; fi) | $(if [ "$TOTAL_REFLECTIONS" -gt 0 ]; then awk "BEGIN {if ($MANUAL_CORRECTIONS/$TOTAL_REFLECTIONS < 1.0) print \"✅\"; else print \"❌\"}"; else echo "⏳"; fi) |
| Clear gaps identified | Yes | [USER] | [USER] |
| Consistent usage | Near-daily | $(if [ "$TOTAL_REFLECTIONS" -ge 12 ]; then echo "✅"; else echo "❌"; fi) | $(if [ "$TOTAL_REFLECTIONS" -ge 12 ]; then echo "✅"; else echo "❌"; fi) |

### Recommendation

_[USER TO COMPLETE: Based on thresholds and analysis]_

**Decision:** [Proceed to V2 / Iterate on V1 / Pause and rethink]

**Justification:**
- [Reason 1]
- [Reason 2]
- [Reason 3]

---

## Identified Gaps

_[USER TO COMPLETE: Transfer from GAP_ANALYSIS.md]_

### What V1 Does Well
- [Capability 1 + evidence]
- [Capability 2 + evidence]

### What V1 Struggles With
- [Gap 1 + examples]
- [Gap 2 + examples]

### What V1 Doesn't Do At All
- [Missing 1]
- [Missing 2]

### Critical Gaps for V2
- [Priority 1 gap]
- [Priority 2 gap]

---

## Next Steps

### If Proceeding to V2:
1. Generate V2 requirements: Complete V2_REQUIREMENTS.md with evidence-based requirements
2. Prioritize V2 features based on identified critical gaps
3. Design V2 architecture addressing core limitations
4. Plan V2 validation framework

### If Iterating on V1:
1. Implement quick wins to address identified friction
2. Run extended validation (1-2 more weeks)
3. Re-evaluate with updated data

### If Pausing:
1. Document fundamental issues discovered
2. Explore alternative approaches
3. Validate assumptions before rebuilding

---

## Appendices

### Appendix A: Data Sources
- Daily metrics: \`metrics/daily/*.json\`
- Weekly reports: \`reports/week-*.md\`
- Usage journal: \`USAGE_JOURNAL.md\`
- Weekly reflections: \`WEEKLY_REFLECTIONS.md\`

### Appendix B: Week Comparison
See \`reports/week-1-vs-2.md\` for detailed week-over-week comparison.

### Appendix C: Testing Scenarios Results
_[USER TO COMPLETE: Document results from testing scenarios in TESTING_FRAMEWORK.md]_

**Scenario 1 - Single-Day Thread:**
- Result: [Pass/Fail]
- Notes: [Observations]

**Scenario 2 - Multi-Day Thread:**
- Result: [Pass/Fail]
- Notes: [Observations]

**Scenario 3 - Parallel Threads:**
- Result: [Pass/Fail]
- Notes: [Observations]

**Scenario 4 - Discovery Preservation:**
- Result: [Pass/Fail]
- Notes: [Observations]

**Scenario 5 - Query Effectiveness:**
- Result: [Pass/Fail]
- Notes: [Observations]

---

**Report Generated By:** synthesis-report.sh  
**Timestamp:** $TIMESTAMP  
**Validation Period:** 14 days ($START_DATE to $END_DATE)

_This is a living document. Update sections marked [USER TO COMPLETE] with qualitative observations and analysis._
EOF

echo -e "${GREEN}Synthesis report generated!${NC}"
echo "Output: $OUTPUT_FILE"
echo
echo "Next steps:"
echo "  1. Review the report: $OUTPUT_FILE"
echo "  2. Complete sections marked [USER TO COMPLETE]"
echo "  3. Add qualitative observations from journals"
echo "  4. Complete GAP_ANALYSIS.md"
echo "  5. Generate V2_REQUIREMENTS.md (if proceeding to V2)"
