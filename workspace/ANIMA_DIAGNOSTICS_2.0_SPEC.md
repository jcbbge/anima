# ANIMA DAILY DIAGNOSTICS 2.0
## Design Specification — World-Class DX/UX/AX

---

## Core Philosophy Shift

**From:** "What records were created?"  
**To:** "Is Anima healthy? What's the story? Where should we look?"

The current report is a **data telescope** — shows everything, understands nothing.  
The 10x version is a **diagnostic companion** — understands context, surfaces insight, invites exploration.

---

## Information Architecture: Three Tiers

### Tier 1: GLANCE (Default View)
**Purpose:** 3-second health assessment  
**Output:** ~20 lines, visual, color-coded

```
┌─────────────────────────────────────────────────────────────┐
│  ANIMA DAILY DIAGNOSTICS          2026-03-16 18:42 UTC      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  OVERALL HEALTH    ████████████████████░░░░  ████  GOOD      │
│                                                             │
│  ├─ Metabolism     ████████████░░░░░░░░░░  ███░  ACTIVE    │  ← memories created
│  ├─ Synthesis      ████████████████░░░░░░░  ████  HEALTHY  │  ← fold_log runs
│  ├─ Continuity     ██████████████░░░░░░░░░  ███░  STABLE   │  ← ghost_logs/sessions
│  └─ Associations   █████████████████████░  █████ HEAVY    │  ← (flag: unusual volume)
│                                                             │
│  ANOMALIES DETECTED: 1                                      │
│  ⚠️  Unusual association volume: 36,448 (expected: ~100)   │
│      → Run `anima report --drill=associations` to inspect  │
│                                                             │
│  NARRATIVE: Busy synthesis day — 3 fold cycles, 16 new     │
│  memories, heavy cross-connection activity. Reflections     │
│  indicate high-quality sessions (quality: 8.3/10).          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Tier 2: CONTEXT (`--context` flag)
**Purpose:** Understand the patterns, compare to baseline  
**Output:** ~100 lines, insights with comparison data

Sections:
- **Activity Patterns:** Today's counts vs 7-day average vs 30-day average
- **Quality Metrics:** Reflection scores trend, synthesis phi accumulation
- **Correlation Insights:** "High memory count + high associations = cross-pollination event"
- **System Velocity:** Memories/hour, associations/memory ratio

### Tier 3: DETAIL (`--detail` or `--table=X`)
**Purpose:** Full record inspection when needed  
**Output:** Current behavior but paginated/filtered

```
anima report                    # Tier 1: glance (default)
anima report --context          # Tier 2: patterns & insights
anima report --detail           # Tier 3: full sections, sample records
anima report --table=memories   # Deep dive on specific table
anima report --anomalies-only   # Just the warning flags
anima report --health-check     # Exit code 0/1 for CI/automation
```

---

## Key Metrics That Matter

### Metabolism (Memory Creation)
- **Count:** New memories today
- **Tier Distribution:** thread/stable/network/active breakdown
- **Phi Accumulation:** Average resonance_phi of new memories
- **Source Mix:** cli / synthesis / mcp / other ratios
- **🚩 Anomaly:** Zero memories (system stalled) or >100 (potential loop)

### Synthesis (Fold Activity)
- **Runs:** Number of synthesis cycles
- **Trigger Distribution:** phi_threshold vs scheduled vs manual
- **Phi Delta:** Net phi change (before → after)
- **Duration:** Average synthesis time (health indicator)
- **🚩 Anomaly:** Failed runs, zero runs with high memory creation

### Continuity (Session Health)
- **Bootstraps:** Number of ghost_logs (session starts)
- **Top Phi Values Trend:** Are catalysts being surfaced?
- **Conversation Diversity:** Unique conversation_ids
- **🚩 Anomaly:** No bootstrap with new memories (MCP not wired)

### Cross-Connection (Association Health)
- **New Associations:** Created today
- **Updated Associations:** Strengthened existing
- **Connections per Memory:** Ratio (quality indicator)
- **🚩 Anomaly:** >1000 associations/day (investigate trigger)

### Self-Awareness (Reflection Quality)
- **Reflections Count:** Sessions with recorded reflection
- **Average Quality:** context_quality score
- **Average Continuity:** continuity_score
- **Emergence Moments:** Count of had_emergence_moment
- **🚩 Anomaly:** Low scores (<5) or no reflections despite activity

---

## Anomaly Detection Rules

```typescript
const ANOMALIES = {
  // Metabolism
  NO_MEMORIES: { severity: 'critical', check: (m) => m === 0 },
  HIGH_MEMORIES: { severity: 'warning', check: (m) => m > 100 },
  LOW_PHI: { severity: 'info', check: (avg) => avg < 2.0 },

  // Synthesis
  NO_SYNTHESIS: { severity: 'warning', check: (f) => f === 0 },
  HIGH_SYNTHESIS: { severity: 'info', check: (f) => f > 10 },
  SLOW_SYNTHESIS: { severity: 'warning', check: (avg) => avg > 10000 },

  // Continuity
  NO_BOOTSTRAP: { severity: 'critical', check: (g) => g === 0 },

  // Associations
  ASSOCIATION_SPIKE: { severity: 'warning', check: (a) => a > 1000 },

  // Reflections
  NO_REFLECTIONS: { severity: 'warning', check: (r) => r === 0 },
  LOW_QUALITY: { severity: 'warning', check: (avg) => avg < 5.0 },
};
```

---

## CLI Interface Design

### Command Structure
```
anima report [date] [options]

Arguments:
  date              Specific date (YYYY-MM-DD), default: today

Options:
  -c, --context     Show contextual insights (Tier 2)
  -d, --detail      Show detailed records (Tier 3)
  -t, --table       Deep dive on table: memories|fold_log|ghost_logs|...
  -a, --anomalies   Show only anomalies
  -h, --health      Health check mode (exit code only)
  -j, --json        JSON output for piping
  --no-color        Disable color output
```

### Exit Codes (for automation)
- `0`: Healthy, no anomalies
- `1`: Warnings present
- `2`: Critical anomalies

---

## Visual Design System

### Color Coding (terminal)
- 🟢 Green: Healthy, normal range
- 🟡 Yellow: Warning, elevated but not critical
- 🔴 Red: Critical, requires attention
- 🔵 Blue: Informational/context
- ⚪ White: Labels/structure
- 📊 ASCII sparklines for trends

### Layout Principles
- **Grid-based:** Box-drawing characters for structure
- **Progress bars:** For health scores (0-100%)
- **Hierarchical:** Indentation shows relationships
- **Breathing room:** Empty lines between sections
- **Right-aligned:** Numbers align for easy scanning

### Typography
- Bold for section headers
- Dim for secondary info
- Italic (if supported) for narrative
- Emoji/sparkles for memorable moments (✨🌱🔥)

---

## The Narrative Engine

Generate a 1-2 sentence "story" of the day based on data patterns:

```typescript
function generateNattern(metrics) {
  if (metrics.memories > 50 && metrics.associations > 1000)
    return "Heavy cross-pollination day — significant connection weaving between concepts.";

  if (metrics.fold_log > 5 && metrics.avg_phi > 4.0)
    return "Deep synthesis day — multiple transformation cycles with high-resonance output.";

  if (metrics.memories === 0)
    return "Quiet day — no new memory formation. System in maintenance mode?";

  if (metrics.avg_quality < 5.0)
    return "Challenging sessions — reflection scores indicate friction or disconnection.";

  return "Steady activity day — normal metabolism and synthesis rhythms.";
}
```

---

## Implementation Plan

### Phase 1: Foundation (today)
1. Create new report structure with three tiers
2. Implement health scoring system
3. Add anomaly detection
4. Build glance view (default)

### Phase 2: Context (this week)
1. Add 7-day and 30-day rolling averages
2. Implement comparison metrics
3. Build contextual insights
4. Add narrative generation

### Phase 3: Polish (next week)
1. Add color coding and visual design
2. Implement CLI args (--context, --detail, etc.)
3. Add JSON output mode
4. Create health check exit codes

### Phase 4: Intelligence (future)
1. Trend prediction ("At this rate, tier:thread will reach 1000 by...")
2. Correlation detection ("High X correlates with Y 3 days later")
3. Proactive alerts ("Unusual pattern developing...")

---

## Success Metrics for This Design

1. **Time to Insight:** <3 seconds to understand health
2. **Actionability:** Every anomaly has a suggested next step
3. **Memorability:** Distinctive visual style you recognize instantly
4. **Extensibility:** Easy to add new metrics/sections
5. **Automation:** Exit codes enable CI/CD integration

---

## The 10x Moments

| Before | After |
|--------|-------|
| 36,000 lines of raw data | 20-line health dashboard |
| Manual pattern hunting | Auto-detected anomalies with explanations |
| "What happened?" | "Here's the story + what's unusual" |
| One-size-fits-all | Three tiers for different needs |
| Text-only | Color-coded, visual progress bars |
| Human-only consumption | Machine-readable JSON + exit codes |
| Passive report | Active diagnostic companion |

---

**This transforms `anima report` from a data dump into a trusted daily companion that understands Anima's health and guides attention where it matters.**
