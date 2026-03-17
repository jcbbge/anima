# Anima Daily Diagnostics Report — Design Specification v3.0

## Executive Summary

**Current State:** Your `daily_report.ts` is already sophisticated — three tiers, anomaly detection, health scoring, ASCII rendering. It's functional, not broken.

**The Gap:** The report answers "what happened" but not "what does it mean." With 36,448 associations today, the detail view is unusable. The narrative is thin.

**Goal:** Transform from *data dump* → *diagnostic story*

---

## Architecture: The Four-Tier Model

The existing three-tier model is sound, but we'll refine it:

| Tier | Name | Output | Time to Scan | Use Case |
|------|------|--------|--------------|----------|
| 1 | **Pulse** | Health status, top-line metrics, critical alerts | 3 seconds | Daily standup check |
| 2 | **Context** | Trends, comparisons, pattern flags | 30 seconds | Understanding the day |
| 3 | **Investigation** | Anomaly drill-down, component deep-dive | 2-5 min | Debugging specific issues |
| 4 | **Raw Export** | Full JSON/CSV for external tooling | — | CI/CD, dashboards, archives |

**CLI Design:**
```bash
# Default (tier 1)
deno task report

# Tier 2: context + trends
deno task report --context

# Tier 3: full detail
deno task report --detail

# Tier 4: raw export
deno task report --export json  # or csv

# Drill into specific component
deno task report --investigate associations

# Time machine
deno task report 2026-03-14

# Health check for CI
deno task report --health
```

---

## Tier 1: The Pulse View

### Current (Good)
- ASCII box with health bar
- Overall score + component breakdown
- Anomaly summary (first 2)
- Auto-generated narrative

### Enhancement: "The Headline"

Add a **single-line headline** at the top that captures the day's essence:

```
╔══════════════════════════════════════════════════════════════╗
║  ANIMA DAILY DIAGNOSTICS — 2026-03-16                        ║
╠══════════════════════════════════════════════════════════════╣
║  ⚡ HEAVY SYNTHESIS DAY — 4 cycles, +18.2 net φ, 2 emergences ║
╠══════════════════════════════════════════════════════════════╣
```

**Headline patterns to detect:**
| Pattern | Trigger | Headline |
|---------|---------|----------|
| Quiet day | memories == 0 | "😴 Quiet day — system in maintenance mode" |
| Heavy synthesis | foldLog > 3 && avgPhi > 4 | "⚡ Deep synthesis day — N cycles, +X net φ" |
| Association spike | associations > 1000 | "🔗 Cross-pollination spike — X connections" |
| Quality sessions | avgQuality > 8 | "✨ Quality sessions — avg continuity X/10" |
| Broken continuity | memories > 0 && ghosts == 0 | "⚠️ Continuity broken — no boots with memories" |
| Accumulation | memories > 20 && folds == 0 | "📚 Accumulation without digestion" |

### Health Score Refinement

Current scoring is linear. Add **trend context**:

```
OVERALL: ████████████████░░░░ 78 HEALTHY ▲+12 from yesterday
  ├─ Metabolism   ██████████████░░░ 85 ACTIVE
  ├─ Synthesis    ██████████████░░░ 72 HEALTHY
  ├─ Continuity   ██████████░░░░░░░░ 45 DEGRADED ▼-8
  └─ Associations █████████████████ 100 NORMAL
```

**Recommendation:** Store yesterday's health in `fold_config` or a dedicated `daily_health_log` table, then compute delta.

---

## Tier 2: Contextual Insights

### A. Trend Comparisons

Current has 7-day comparison. Add:

1. **30-day baseline** — detect seasonality, growth trends
2. **Same-day-last-week** — weekly pattern detection
3. **Percentile ranking** — "this is in the top 5% of all days"

```typescript
// Pseudocode for percentile
const historicalMemories = await query(`
  SELECT count() as cnt FROM memories 
  WHERE created_at < <datetime>"${startISO}" 
  GROUP ALL
`);
// Compute percentile of today's count against all previous days
```

### B. Pattern Flags

Detect recurring patterns that warrant attention:

| Pattern | Detection | Flag |
|---------|-----------|------|
| **Idle→Burst** | 0 memories for 6hrs, then >10 in 1hr | "Burst activity after idle period" |
| **Phi erosion** | avgPhi declining over 7 days | "Resonance erosion — content significance down" |
| **Session drift** | continuity_score declining over week | "Context continuity weakening" |
| **Synthesis backlog** | memories increasing, folds stable | "Synthesis can't keep up with ingestion" |
| **Tag explosion** | associations/memory ratio > 50 | "Possible tag/category explosion" |

### C. Memory Tier Narrative

Add interpretative text for tier distribution:

```
Active: 12 (45%) — fresh, high-relevance content
Thread: 8 (30%) — evolving narratives
Stable: 4 (15%) — settled knowledge
Network: 3 (10%) — cross-session connections
```

With narrative: "Heavy active tier — high turnover, fast context switching today."

### D. Synthesis Story

Rather than just listing triggers, tell the story:

```
Synthesis: 4 cycles, avg 3.2s, +18.4 net φ
  ━ auto-trigger: 2 cycles — background consolidation
  ━ manual: 2 cycles — explicit reflection triggers
  
Net φ gain: +18.4 — strong deepening
  "Each cycle reinforced the last, compounding insight"
```

---

## Tier 3: Investigation Mode

### The 36K Problem

With 36,448 associations, you cannot show them all. Solution: **Intelligent Sampling**

**Sampling Strategy:**

| Scenario | Sample Strategy |
|----------|-----------------|
| Normal day (<500 assocs) | Show all |
| Heavy day (>500) | Show top 20 by strength + random sample |
| Spike (>1000) | Statistical summary: distribution, percentiles |

**Implementation:**
```typescript
const associations = await query(`
  SELECT * FROM memory_associations
  WHERE created_at >= <datetime>"${startISO}" AND created_at < <datetime>"${endISO}"
  ORDER BY strength DESC
  LIMIT 20
`);
// Plus compute: count, avg_strength, p50, p95, p99
```

### Investigation Views by Component

For each table, provide specific investigation paths:

#### `--investigate associations`
```
ASSOCIATIONS: 36,448 created, 142 updated
  Distribution: ████████████░░░░░░░░░░░░░  (heavily right-skewed)
  p50: 0.23  p95: 0.71  p99: 0.89
  
  Strongest (top 5):
    ━ memory:abc123 ↔ memory:def456 (0.94) — "TypeScript patterns"
    ━ memory:ghi789 ↔ memory:jkl012 (0.91) — "API design principles"
    ...
  
  Suspicious patterns:
    ⚠️ 847 associations share single source memory — possible tag cascade
    ⚠️ 23 memories have >100 associations — likely bulk-import artifacts
```

#### `--investigate synthesis`
```
SYNTHESIS CYCLES: 4 runs, avg 3.2s
  Timeline:
    09:14:22 — auto-trigger — +2.1φ — 2.8s
    11:42:08 — manual — +5.3φ — 4.1s
    14:18:55 — auto-trigger — +3.8φ — 2.9s
    16:33:41 — manual — +7.2φ — 3.0s
  
  Anomalies:
    ⚠️ Run at 11:42 took 4.1s — outlier (avg +28%)
    ✓ Net φ positive — synthesis working as intended
```

#### `--investigate continuity`
```
GHOST BOOTS: 7 sessions, 4 unique conversations
  Session quality:
    ━ conv:abc123 — quality: 8.2, continuity: 7.9, emergence: 1
    ━ conv:def456 — quality: 6.1, continuity: 4.2 (⚠️ low!)
    ...
  
  Continuity trend: 7-day slope -0.3/10 per day
  "Slight degradation — sessions increasingly struggling to hold context"
```

---

## Tier 4: Export Mode

For external tooling, CI/CD, dashboards:

```bash
# JSON for programmatic consumption
deno task report --export json --output ./reports/today.json

# CSV for spreadsheets
deno task report --export csv --output ./reports/today.csv

# Prometheus metrics format
deno task report --export prometheus
```

**JSON schema:**
```json
{
  "meta": {
    "date": "2026-03-16",
    "generated": "2026-03-16T18:00:00Z",
    "version": "3.0"
  },
  "health": {
    "overall": 78,
    "trend": "+12",
    "components": { ... }
  },
  "headline": "Heavy synthesis day",
  "metrics": { ... },
  "anomalies": [ ... ],
  "narrative": "...",
  "investigation": {
    "associations": { "count": 36448, "p50": 0.23, "p95": 0.71 },
    "synthesis": { ... },
    "continuity": { ... }
  }
}
```

---

## Anomaly Detection: Expanded Rules

Current rules are good. Add:

| Severity | Component | Trigger | Interpretation |
|----------|-----------|---------|----------------|
| critical | Ghost | No boots in 48h | System not being used — check MCP wiring |
| critical | Memories | >1000 in 1hr | Possible injection attack or runaway store |
| warning | Associations | avg_per_memory > 100 | Tag explosion or circular references |
| warning | Synthesis | phi_after < phi_before (net negative) | Synthesis degrading — check prompt/model |
| warning | Continuity | avg < 5 for 3+ days | Systemic context failure |
| info | Tier | active > 80% of memories | High turnover, unstable memory landscape |
| info | Timing | All ghosts in same hour | Single long session — good focus or stuck? |

---

## Visual Design Guidelines

### Current Strengths
- ASCII box is clean and scannable
- Health bar visualization works well
- Color coding (green/yellow/red) is intuitive

### Improvements

**1. Use visual hierarchy — not just color**
```
HEADLINE (bold, large)
├─ Section 1
│  └─ Detail
├─ Section 2
│  └─ Detail
FOOTER (dim)
```

**2. Emojis as semantic markers**
```
⚡ Synthesis activity
🔗 Associations  
✨ Emergence moments
⚠️ Warnings
😴 Idle/stalled
📈 Growth
📉 Decline
```

**3. Sparklines for trends**
```
Memory count (7 days): ▁▃▅▆▇███ (↑200%)
Synthesis cycles:      ▅▅▅▆▆▇▇ (→ stable)
```

**4. Compact mode for automation**
```
[HEALTHY] 78/100 (+12) | Memories: 24 | Synthesis: 4 | Ghosts: 7 | Assocs: 36448
```

---

## Agent-First Design

When an AI assistant reads this report, what do they need?

### Essential Questions to Answer

1. **Is the system alive?** → Yes/No + uptime indicators
2. **Is it working correctly?** → Health score + anomaly list
3. **What's the narrative?** → Headline + summary paragraph
4. **Should I act?** → Priority flags + action items

### Structured for LLM Parsing

```typescript
// Machine-readable summary at top of JSON output
"for_agent": {
  "health_status": "healthy|degraded|critical",
  "action_required": boolean,
  "top_priority": "string", // most urgent anomaly/recommendation
  "key_metrics": {
    "memories_created": number,
    "synthesis_cycles": number,
    "continuity_score": number
  },
  "narrative_summary": "string", // 1-2 sentences
  "should_notify": boolean,
  "notification_reason": "string" | null
}
```

### Example Agent Workflow

```
Agent reads report → 
  if health < 60 → investigate cause →
    if anomaly exists → notify human with recommendation →
      if critical → escalate immediately
```

---

## Recommendations Summary

### Immediate (v3.0)
1. **Add headline** — single-line summary at top
2. **Fix association display** — sampling + distribution stats instead of raw dump
3. **Add `--investigate <component>`** — dedicated drill-down views
4. **Store daily health** — enable trend comparisons

### Short-term (v3.1)
1. **Pattern detection** — idle→burst, phi erosion, session drift
2. **Tier narrative** — interpret what tier distribution means
3. **Synthesis story** — not just triggers, what happened during each cycle
4. **Percentile ranking** — "top 5% day"

### Medium-term (v3.2)
1. **Export modes** — JSON, CSV, Prometheus
2. **For-agent schema** — structured for LLM consumption
3. **Sparklines** — 7-day trend visualization
4. **Notification rules** — when to alert, auto-ack

---

## What "Healthy" Looks Like

| Metric | Healthy | Attention Needed | Critical |
|--------|---------|-----------------|----------|
| Memories/day | 5-50 | <5 or >100 | 0 or >500 |
| Synthesis cycles | 1-5 | 0 with activity, >10 | negative phi delta |
| Associations/memory | <20 | 20-50 | >100 |
| Avg phi | 2.5-4.5 | <2 or >5 | 0 |
| Continuity score | >7 | 5-7 | <5 |
| Ghost boots | 3-10 | 0 with memories | 0 for 48h+ |
| Emergence moments | >0 | — | — |

---

## Open Questions

1. **Historical baseline storage** — Should `fold_config` track daily metrics, or a new `daily_health_log` table?
2. **Alerting** — Integrate with existing notification system, or keep report-focused?
3. **Export consumers** — What external systems need this data? (Dashboards? PagerDuty? Slack?)
4. **Real-time** — Should this be a live dashboard, or just daily report?

---

*This spec transforms the report from "what happened" to "what it means" — giving both humans and AIs immediate diagnostic understanding.*