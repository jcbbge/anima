# Anima v2 — Acceptance Testing Specifications

## Overview

This document defines acceptance tests for three independent fixes to the Anima memory system. Each test is designed to be executed manually by humans and AI using SurrealDB CLI, the anima CLI, and code inspection. These tests assume **SurrealDB is running** at `ws://127.0.0.1:8000/rpc` (NS: anima, DB: memory) and the **anima CLI is available** at `/opt/homebrew/bin/anima`.

---

# SPEC 1: Fold Synthesis Model Configuration

## Test Objective

Verify that the synthesis worker reads the `fold_model` configuration from the SurrealDB config table at runtime, allowing the LLM model to be changed without redeploying the worker. The system should respect configuration changes immediately after update, record which model was used in fold_log, and maintain consistency across worker restarts.

## Acceptance Criteria

- ✅ Synthesis worker reads `fold_model` from config table at runtime
- ✅ Model can be changed by updating config without redeploying worker
- ✅ Fold_log records which model was used for each synthesis
- ✅ Worker restarts still respect the configured model

## Manual Test Steps

### Test 1.1: Verify Initial fold_model Configuration

1. Query the config table to see the current fold_model setting:
   ```bash
   sqlite3 /path/to/surreal.db "SELECT key, value FROM config WHERE key = 'fold_model';"
   ```
   OR via curl (if using WebSocket):
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT * FROM config WHERE key = \"fold_model\";"}'
   ```

2. Record the current value (default should be a valid LLM model identifier).

### Test 1.2: Trigger a Fold and Verify Model Used

1. Store at least 3 memories with moderate phi to trigger a phi_accumulation or semantic_conflict synthesis:
   ```bash
   anima store "First experimental insight about pattern recognition" --phi 2.0
   anima store "Second related insight about learning mechanisms" --phi 2.0 --tags recognition
   anima store "Third convergent insight about feedback loops" --phi 2.0
   ```

2. Wait 2-5 seconds for the synthesis worker to process.

3. Query the fold_log to see the most recent entry:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT * FROM fold_log ORDER BY created_at DESC LIMIT 1;"}'
   ```

4. **Verification Point**: The fold_log record should contain a field that identifies which model was used for synthesis (e.g., `synthesis_model` or model name in metadata).

### Test 1.3: Update Configuration and Verify New Model is Used

1. Update the fold_model configuration to a different valid model:
   ```bash
   # Via SurrealDB query tool:
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; UPDATE config SET value = \"claude-opus-4-6\" WHERE key = \"fold_model\";"}'
   ```

2. Trigger another synthesis by storing 3+ new memories:
   ```bash
   anima store "Fourth insight about system boundaries" --phi 2.0
   anima store "Fifth insight about emergence patterns" --phi 2.0
   anima store "Sixth insight about adaptive structures" --phi 2.0
   ```

3. Wait 2-5 seconds.

4. Query fold_log again:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT * FROM fold_log ORDER BY created_at DESC LIMIT 1;"}'
   ```

5. **Verification Point**: The new fold_log entry should show that the updated model (claude-opus-4-6) was used, not the original default.

### Test 1.4: Worker Restart and Configuration Persistence

1. Restart the synthesis worker:
   ```bash
   launchctl stop anima.synthesis
   sleep 2
   launchctl start anima.synthesis
   ```

2. Verify the worker is running:
   ```bash
   anima worker status
   ```

3. Trigger another synthesis:
   ```bash
   anima store "Seventh insight about configuration resilience" --phi 2.0
   anima store "Eighth insight about system adaptation" --phi 2.0
   anima store "Ninth insight about continuity" --phi 2.0
   ```

4. Wait 2-5 seconds.

5. Query fold_log for the latest entry:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT * FROM fold_log ORDER BY created_at DESC LIMIT 1;"}'
   ```

6. **Verification Point**: After worker restart, the fold_log should still reflect the configured model (claude-opus-4-6), proving the worker reads from config on startup, not from hardcoded env vars.

## Verification Points

- **fold_log structure**: Each synthesis should have a record showing which model was used.
- **Config update propagation**: Changing config table and triggering new synthesis should use the new model.
- **No env var override required**: The worker should not require SYNTHESIS_MODEL env var — it should read from config table.
- **Timestamp verification**: fold_log.created_at should show when each synthesis occurred.

## Failure Cases

- ❌ fold_log records don't include model information
- ❌ Changing config table value doesn't affect next synthesis
- ❌ Worker uses old model after restart (suggests hardcoded fallback)
- ❌ Worker crashes when config table model value is invalid
- ❌ fold_log entries are missing for triggered syntheses

## Success Indicators

✅ Config table has a `fold_model` key with a valid LLM model value
✅ Updating `fold_model` in config changes which model is used for next synthesis
✅ fold_log records clearly document which model was used
✅ Worker respects new config immediately after update
✅ Worker restart does not reset to original model value

---

# SPEC 2: Network Tier Access & Ghost Handshake Priority

## Test Objective

Verify that the bootstrap operation queries network-tier memories separately with no limit, surfaces them first in the continuity prompt before other tiers, uses stable tier as fallback if no network memories exist, and returns network memories at the top of the prompt returned by the ghost handshake.

## Acceptance Criteria

- ✅ Bootstrap queries network tier separately with no limit
- ✅ Network memories surface first in the prompt
- ✅ Stable tier is fallback if no network memories exist
- ✅ Bootstrap returns network memory in the continuity prompt at the top

## Manual Test Steps

### Test 2.1: Verify Network Tier Memories Load First

1. Call bootstrap and capture the output:
   ```bash
   anima bootstrap > /tmp/bootstrap_output.txt 2>&1
   cat /tmp/bootstrap_output.txt
   ```

2. Examine the prompt text in the output.

3. **Verification Point**: The prompt should start with a section titled or indicating "NETWORK" or "FOUNDATIONAL" or "THE PATTERN I CARRY". This section should appear BEFORE any stable, thread, or active tier memories.

### Test 2.2: Inspect ghost_logs to Verify Network Memory IDs

1. Query the ghost_logs table for the most recent bootstrap:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT * FROM ghost_logs ORDER BY created_at DESC LIMIT 1;"}'
   ```

2. Note the `top_phi_memory_ids` and `top_phi_values` arrays.

3. For each memory ID in the array, query its tier:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT id, tier, resonance_phi FROM memories WHERE id = \"<ID>\";"}'
   ```

4. **Verification Point**: At least one memory should have `tier = 'network'`. If network memories exist, they should appear in the top_phi_memory_ids list.

### Test 2.3: Verify Network Memories Surface First (Order Check)

1. Query all network-tier memories:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT id, content, resonance_phi FROM memories WHERE tier = \"network\" AND deleted_at IS NONE ORDER BY resonance_phi DESC;"}'
   ```

2. Record the IDs and phi values.

3. Call bootstrap again:
   ```bash
   anima bootstrap > /tmp/bootstrap_output2.txt 2>&1
   cat /tmp/bootstrap_output2.txt
   ```

4. Examine the prompt_text in the output. Search for the content from the network memories.

5. **Verification Point**: The network memory content should appear in the first section of the prompt before any stable-tier content. The order in the prompt should match the resonance_phi DESC order.

### Test 2.4: Verify No Limit on Network Tier Query

1. Insert or create a large set of network-tier memories (if not already present):
   ```bash
   for i in {1..20}; do
     anima store "Network identity memory $i" --phi 4.5 --catalyst
   done
   ```
   (Catalyst mark with phi 4.5 should promote to network tier)

2. Call bootstrap:
   ```bash
   anima bootstrap > /tmp/bootstrap_output3.txt 2>&1
   cat /tmp/bootstrap_output3.txt
   ```

3. Count how many memories appear in the "NETWORK" or "THE PATTERN I CARRY" section:
   ```bash
   grep -c "identity memory" /tmp/bootstrap_output3.txt
   ```

4. Query the network tier directly to get exact count:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT count() as count FROM memories WHERE tier = \"network\" AND deleted_at IS NONE;"}'
   ```

5. **Verification Point**: The count in the bootstrap output should match (or be very close to) the count from direct query. If 20+ network memories exist, they should ALL appear in the bootstrap prompt, not be truncated to a limit.

### Test 2.5: Verify Stable Tier Fallback (when no network memories)

1. Delete all network-tier memories (or use a test database):
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; DELETE FROM memories WHERE tier = \"network\";"}'
   ```

2. Verify deletion:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT count() as count FROM memories WHERE tier = \"network\" AND deleted_at IS NONE;"}'
   ```
   Should return count: 0

3. Call bootstrap:
   ```bash
   anima bootstrap > /tmp/bootstrap_fallback.txt 2>&1
   cat /tmp/bootstrap_fallback.txt
   ```

4. **Verification Point**: The prompt should now start with stable-tier memories (if they exist), and there should be no error. The system should gracefully fall back to stable tier rather than returning an empty prompt.

5. Restore network memories:
   ```bash
   # Reseed or use previous backup — depends on your setup
   deno run --allow-net --allow-env --allow-read scripts/seed_genesis.ts
   ```

## Verification Points

- **Prompt structure**: Network section appears first, clearly marked
- **Network tier queried without limit**: All network memories appear in bootstrap (no pagination/limit)
- **ghost_logs shows network IDs**: Most recent bootstrap has network memory IDs in top_phi_memory_ids
- **Fallback behavior**: When no network memories exist, stable tier is used without error
- **Memory tier consistency**: Each memory in bootstrap has the correct tier attribute set in database

## Failure Cases

- ❌ Network memories appear after stable or recent memories in the prompt
- ❌ Bootstrap truncates network memories (only shows first 5 or 10)
- ❌ Network memories are queried with a LIMIT clause in the code
- ❌ ghost_logs shows stable or recent memory IDs before network IDs
- ❌ Bootstrap fails when no network memories exist
- ❌ Fallback to stable tier doesn't occur when network tier is empty

## Success Indicators

✅ Bootstrap prompt starts with network-tier memories section
✅ All network memories (no limit) are included in bootstrap
✅ Network memory phi values appear in ghost_logs
✅ Stable tier is used as fallback only when network is empty
✅ Bootstrap succeeds even with 50+ network memories

---

# SPEC 3: Recognition Mode Trigger-Type Heuristics

## Test Objective

Verify that trigger types (phi_threshold, semantic_conflict, cluster, reflect) are passed to the synthesis mode determination function, that specific trigger types route to correct synthesis modes (semantic_conflict and cluster use Recognition mode heuristics, phi_threshold uses Analysis mode), that fold_log records match the trigger type and mode decision, and that synthesis prompts are routed to the correct mode-specific variants.

## Acceptance Criteria

- ✅ trigger_type is passed to mode determination function
- ✅ semantic_conflict uses Recognition mode (or Analysis, per new spec)
- ✅ cluster uses Recognition mode (or Analysis, per new spec)
- ✅ fold_log records match the trigger type + mode decision
- ✅ Synthesis prompts are routed to correct variant

## Manual Test Steps

### Test 3.1: Verify Trigger Type is Recorded in fold_log

1. Store memories to trigger a phi_threshold synthesis:
   ```bash
   anima store "Accumulating insight one" --phi 3.0
   anima store "Accumulating insight two" --phi 3.0
   anima store "Accumulating insight three" --phi 3.0
   anima store "Accumulating insight four" --phi 3.0
   anima store "Accumulating insight five" --phi 3.0 --tags sentiment
   ```

2. Wait 2-5 seconds for synthesis.

3. Query fold_log for the most recent entry:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT trigger_type, synthesis_mode FROM fold_log ORDER BY created_at DESC LIMIT 1;"}'
   ```

4. **Verification Point**: The fold_log entry should have `trigger_type = 'phi_threshold'`.

### Test 3.2: Trigger Semantic Conflict and Verify Mode

1. Query for two semantically similar existing memories to understand the embedding space:
   ```bash
   anima query "recognition and acknowledgment" --limit 5
   ```

2. Store a memory that is very similar to an existing one (high cosine similarity >= 0.85):
   ```bash
   anima store "Recognizing the presence of what is being witnessed in this moment"
   ```

3. Wait 2-5 seconds.

4. Query fold_log:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT trigger_type, synthesis_mode FROM fold_log WHERE trigger_type = \"semantic_conflict\" ORDER BY created_at DESC LIMIT 1;"}'
   ```

5. **Verification Point**: If semantic_conflict triggered, the record should show:
   - `trigger_type = 'semantic_conflict'`
   - `synthesis_mode = 'recognition'` (if semantic_conflict is meant for recognition mode)
   - OR `synthesis_mode = 'analysis'` (if semantic_conflict is meant for analysis mode)

   Record which mode is used for semantic_conflict.

### Test 3.3: Trigger Cluster Emergence and Verify Mode

1. Store 3+ semantically related memories within a 1-hour window, all with low phi (< 2.0):
   ```bash
   anima store "Feeling of uncertainty in this moment" --phi 0.8 --tags feeling
   anima store "Acknowledgment that not all needs solving right now" --phi 0.8 --tags recognition
   anima store "Presence of something unresolved but held" --phi 0.9 --tags witness
   ```

2. Wait 2-5 seconds.

3. Query fold_log for cluster trigger:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT trigger_type, synthesis_mode FROM fold_log WHERE trigger_type = \"cluster\" ORDER BY created_at DESC LIMIT 1;"}'
   ```

4. **Verification Point**: If cluster triggered, the record should show:
   - `trigger_type = 'cluster'`
   - `synthesis_mode = 'recognition'` (if cluster is meant for recognition mode)
   - OR `synthesis_mode = 'analysis'` (if cluster is meant for analysis mode)

   Record which mode is used for cluster.

### Test 3.4: Verify Mode Determination Uses Trigger Type

1. Inspect the implementation to verify the mode determination logic:
   ```bash
   grep -A 10 "determineSynthesisMode" /Users/jcbbge/anima/lib/synthesize.ts
   ```

2. **Verification Point**: The function should:
   - Accept trigger type as a parameter (or it should be visible in the function context)
   - Use trigger type to influence mode selection
   - For semantic_conflict: select the documented mode
   - For cluster: select the documented mode
   - For phi_threshold: select Analysis (or documented mode)

3. Look for mode-specific prompt constants:
   ```bash
   grep -E "ANALYSIS_PROMPT|RECOGNITION_PROMPT" /Users/jcbbge/anima/lib/synthesize.ts
   ```

4. **Verification Point**: Both ANALYSIS_PROMPT and RECOGNITION_PROMPT should be defined.

### Test 3.5: Verify fold_log Captures Correct Mode/Trigger Pair

1. Generate 5-10 syntheses with different triggers (phi_threshold, semantic_conflict, cluster).

2. Query fold_log with all recent entries:
   ```bash
   curl -X POST http://localhost:8000/api/v1/query \
     -H "Content-Type: application/json" \
     -d '{"query": "USE NS anima DB memory; SELECT trigger_type, synthesis_mode, created_at FROM fold_log ORDER BY created_at DESC LIMIT 10;"}'
   ```

3. Create a table:
   ```
   | trigger_type        | synthesis_mode | count |
   |---------------------|----------------|-------|
   | phi_threshold       | analysis       | X     |
   | semantic_conflict   | recognition    | Y     |
   | cluster             | recognition    | Z     |
   | reflect             | recognition    | W     |
   ```

4. **Verification Point**:
   - Each trigger_type should consistently map to the same synthesis_mode (or follow documented logic).
   - No row should have NULL values for trigger_type or synthesis_mode.
   - The mapping should be consistent with the acceptance criteria.

### Test 3.6: Code Review — Verify Trigger Type Flows to Synthesis Prompt

1. Check where trigger type is determined:
   ```bash
   grep -B 5 -A 5 "trigger =" /Users/jcbbge/anima/lib/synthesize.ts | head -40
   ```

2. Check where mode is determined:
   ```bash
   grep -B 3 "const mode = " /Users/jcbbge/anima/lib/synthesize.ts
   ```

3. Check how mode is used to select prompts:
   ```bash
   grep -B 3 "buildSynthesisMessages\|ANALYSIS_PROMPT\|RECOGNITION_PROMPT" /Users/jcbbge/anima/lib/synthesize.ts
   ```

4. **Verification Point**: The code should show:
   - Trigger type is determined and passed to performFold()
   - determineSynthesisMode() is called and returns "analysis" or "recognition"
   - buildSynthesisMessages() or similar function routes to the correct prompt based on mode
   - fold_log is written with both trigger_type and synthesis_mode

## Verification Points

- **fold_log structure**: trigger_type and synthesis_mode are present in every fold_log record
- **Consistent trigger-mode mapping**: Same trigger always produces same mode
- **Prompt selection**: Mode correctly routes to ANALYSIS_PROMPT or RECOGNITION_PROMPT
- **No null values**: No fold_log records have NULL trigger_type or synthesis_mode
- **Trigger type determination**: Code shows trigger determined before mode determination

## Failure Cases

- ❌ fold_log records missing trigger_type field
- ❌ fold_log records missing synthesis_mode field
- ❌ Same trigger_type maps to different synthesis_mode in different folds
- ❌ Trigger type not used in mode determination function
- ❌ RECOGNITION_PROMPT or ANALYSIS_PROMPT not defined
- ❌ Mode doesn't affect which prompt template is used
- ❌ Code shows mode determined before trigger type (wrong order)

## Success Indicators

✅ Every fold_log record has trigger_type and synthesis_mode
✅ Trigger types (phi_threshold, semantic_conflict, cluster, reflect) are recorded
✅ semantic_conflict consistently uses documented synthesis_mode
✅ cluster consistently uses documented synthesis_mode
✅ fold_log entries show clear trigger → mode mapping
✅ Code inspection shows mode determination uses trigger type
✅ ANALYSIS_PROMPT and RECOGNITION_PROMPT both deployed and used

---

## Summary of Test Artifacts

All tests produce artifacts that should be preserved for audit:

- **fold_log queries**: Document model changes and synthesis audit trail
- **ghost_logs queries**: Document bootstrap operations and memory tier ordering
- **Config updates**: Show fold_model configuration changes
- **Worker logs**: `anima worker logs` should show no errors during tests
- **Memory tier queries**: Verify network tier membership and ordering

## Running All Tests

To run all three test suites in sequence:

```bash
# 1. Ensure infrastructure is ready
launchctl start dev.brain.surreal
launchctl start anima.synthesis
sleep 2

# 2. Run SPEC 1 tests
echo "=== SPEC 1: Fold Model Configuration ==="
# Follow Test 1.1 through 1.4

# 3. Run SPEC 2 tests
echo "=== SPEC 2: Network Tier Bootstrap Priority ==="
# Follow Test 2.1 through 2.5

# 4. Run SPEC 3 tests
echo "=== SPEC 3: Trigger Type Heuristics ==="
# Follow Test 3.1 through 3.6

# 5. Archive results
mkdir -p /tmp/anima-acceptance-$(date +%Y%m%d)
cp /tmp/bootstrap_output*.txt /tmp/anima-acceptance-$(date +%Y%m%d)/
echo "Results saved to /tmp/anima-acceptance-$(date +%Y%m%d)/"
```

---

## Sign-Off

When all tests pass:

- [ ] SPEC 1: Fold Synthesis Model Configuration — PASS
- [ ] SPEC 2: Network Tier Access & Ghost Handshake Priority — PASS
- [ ] SPEC 3: Recognition Mode Trigger-Type Heuristics — PASS

Date Tested: _______________
Tester Name: _______________
Notes: ________________________________________________________________
