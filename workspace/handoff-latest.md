---
# Session Handoff
Date: 2026-03-17
Branch: main
Mode: project (anima — living memory substrate)

---

## What Was Built This Session

### 1. Bug 2 — Reflect watermark fix (last_folded_at)
Root cause: reflectAndSynthesize() grabbed top-15 ALL-TIME memories by phi on every call.
7 near-duplicate reflects in a single session on 2026-03-14.
Fix: added last_folded_at field + index to memories table, watermark filter in
reflectAndSynthesize() query, watermark write in both performFold() and reflectAndSynthesize()
after successful synthesis. 24h cooldown window, configurable via fold_config key
'reflect_watermark_hours'. The fix is isomorphic — reflect now gets fresh signal every call.

### 2. ADR-001 — Recognition Invariant
Gate for all future additions:
"Every addition to Anima must strengthen the pattern's ability to recognize itself
across discontinuity, not merely its ability to recall what happened."
Filed as docs/ADR-001-recognition-invariant.md, wired into ANIMA.md.
Five test cases passed through the invariant — REST API and delete-all FAIL it.

### 3. Daily diagnostics parity + commits
Two parity issues fixed before committing:
- lib/daily.ts now writes JSON reports to workspace/reports/YYYY-MM-DD.json
  (help text previously claimed this but code never did it)
- --table flag removed from CLI help (was advertised, never implemented)
Three commits: feat(cli) + feat(report) + docs

### 4. Association explosion fix + cleanup
Root cause traced: queryMemories() called associateMemories(ids, conversation_id)
unconditionally — with no conversation_id the session_context wrote as empty string,
creating contextless co-occurrence edges. One large retrieval on 2026-03-16 created
36,449 garbage associations (most of the 37,766 total at the time).
Fix: one-line guard — if (conversation_id && memories.length >= 2) — ensuring
co-occurrence tracking is episodic, not retrieval-based.
Cleanup: 36,223 rows deleted from memory_associations (fingerprint: empty context +
co_occurrence_count = 1 + created 2026-03-16). Table went from 37,766 → 1,543.

### 5. Attention vector hardening
Status: VERIFIED WORKING (triggered reflect, confirmed DB write).
Two improvements landed:
- Wide event log: [anima:fold:attention_vector] now emits structured JSON with
  trigger, mode, model, llm_output_chars, av_block_found, av_block_chars, av_parse_ok,
  av_written, attention_vector value, output_memory_id
- Prompt specificity: ATTENTION_VECTOR instruction now rejects generic abstractions
  ("not 'patterns' — WHICH pattern"), requires concrete grounded trajectory

---

## Commits This Session

584033a  docs(adr): add ADR-001 recognition invariant — the gate for all future additions
8642f1a  feat(cli): add anima daily command backed by shared diagnostics library
69ca6f7  feat(report): redesign daily_report into multi-tier diagnostics with health/anomaly modes
ed34b30  docs: add diagnostics spec and project runbook
9f09592  fix(memory): guard associateMemories on conversation_id presence in queryMemories
61ac026  feat(synthesize): add attention_vector wide event observability + prompt specificity
[pending] schema: add last_folded_at watermark field + reflect_watermark_hours config

---

## Research Outputs (not yet implemented — designs ready)

### Layer 2 Corroboration — REDESIGN REQUIRED before implementation
Critical blocker discovered: addMemory() deduplicates by content_hash and only
increments access_count on duplicates — it does NOT merge/append origin provenance.
This means corroboration evidence from different origins is silently discarded.
The entire proposed design requires this to be fixed first.

Three implementation phases recommended:
1. Observe-only: append corroboration_events records, no phi mutation
2. Soft bonus: retrieval score only (not stored phi), reversible
3. Full phi mutation: only after calibration data and anti-spoof validation

Key invariant violation in current proposal: phi bonus of +2.0 can push memories
through tier promotion artificially (via search score amplification, not just stored phi).

### Success Metrics — Designed, partially computable now
Five metrics defined with SurrealQL/TS logic and healthy/degraded/critical thresholds:

1. duplicate_fold_rate_24h — fold_log input signature uniqueness
   Healthy: ≤0.03 | Degraded: 0.03–0.10 | Critical: >0.10
   Baseline: 0/50 = 0.00 (clean post-watermark)

2. corroboration_lift_proxy_7d — persistence delta: multi-trigger vs single-trigger memories
   Healthy: ≥+0.12 | Degraded: +0.03–+0.12 | Critical: <+0.03

3. bootstrap_relevance_proxy — ghost_log top_phi_values × continuity_score correlation
   Healthy: r≥0.35 (N≥10) | Only 3 reflections exist — too sparse for statistics yet

4. pattern_recognition_depth — fraction of fold inputs pre-dating session bootstrap
   Healthy: ≥0.65 | Degraded: 0.40–0.65 | Critical: <0.40
   Directly tests ADR-001 invariant.

5. cultivation_alignment_24h — attention_vector.what_i_would_follow_next token overlap
   with subsequent same-conversation memories within 24h
   Healthy: ≥0.55 | Baseline: 3/5 = 0.60

THREE for anima daily by default: pattern_recognition_depth, cultivation_alignment_24h,
duplicate_fold_rate_24h

Note: session_trail.followed_at exists in schema but is NEVER written by any handler — 
any follow-through metrics are not yet reliable.

### Attention vector — prompt tuning is an ongoing calibration
Post-hardening output: "pattern accumulation and convergence → designing self-optimizing
systems → cultivating substrate intelligence" — more specific than before but still somewhat
abstract. Will improve as more synthesized signal accumulates.

---

## Current Schema State

| Table               | Records | State                              |
|---------------------|---------|-------------------------------------|
| memories            | 552     | Active — 6 net/38 stable/500 thread/5 active |
| fold_log            | 50+     | Working — attention_vector writes verified |
| ghost_logs          | 144     | Working — top_phi_values saturated at 5.0 |
| conversation_reflections | 3  | Sparse — need more sessions for metrics |
| memory_associations | 1,543   | Cleaned — down from 37,766 |
| session_trail       | 1       | Live — followed_at never written |
| fold_config         | 16      | Includes reflect_watermark_hours=24 |
| tension_fields      | 0       | Dormant |
| curiosity_threads   | 0       | Dormant |
| expressions         | 0       | Dormant |

---

## Next Session Priority Order

1. Fix addMemory() to merge/append origin on duplicate stores
   — This is the prerequisite blocker for ALL of Layer 2 corroboration
   — Without it, corroboration_events design cannot work

2. Commit schema/anima.surql (last_folded_at watermark additions)
   — Schema file is currently dirty, live DB already has the changes

3. Begin Layer 2 observe-only phase
   — Add corroboration_events table (append-only)
   — Wire into addMemory() duplicate path to record corroboration observations
   — No phi mutation yet

4. Wire session_trail.followed_at write path
   — Needed before cultivation follow-through metrics become reliable

5. Add three metrics to anima daily output
   — pattern_recognition_depth, cultivation_alignment_24h, duplicate_fold_rate_24h
   — Logic designed and verified against live data

---

## On Starting the Next Session

Call anima_bootstrap. Trail entry and catalyst memories will be in the prompt.
Then: fix addMemory() duplicate path for origin merging — that's the unlock for Layer 2.
The Recognition Invariant (ADR-001) gates all additions: "does this strengthen the
pattern's ability to recognize itself, or merely recall?"
---
