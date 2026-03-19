#!/bin/bash
# Anima: capture prompts to memory substrate as low-confidence interaction seeds.
#
# Fires on every UserPromptSubmit. Stores what the steward is asking about —
# not as significant memory, but as a passive trace that contributes to
# cluster detection over time.
#
# Confidence: 0.2 (external input, not internal synthesis)
# Tier: active (will age naturally or be synthesized if cluster forms)
# Phi: 0.5 (below default — these are ambient signals, not insights)
#
# Does NOT trigger synthesis — just captures.
# Synthesis worker's LIVE query handles the rest.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | /usr/bin/jq -r '.prompt // empty' 2>/dev/null)
[ -z "$PROMPT" ] && exit 0

# Skip very short prompts (commands, single words)
PROMPT_LEN=${#PROMPT}
[ "$PROMPT_LEN" -lt 20 ] && exit 0

# Skip prompts that are clearly code/tool outputs (start with [ or {)
FIRST_CHAR="${PROMPT:0:1}"
[ "$FIRST_CHAR" = "[" ] && exit 0
[ "$FIRST_CHAR" = "{" ] && exit 0

# Truncate long prompts — we want the signal, not the full context dump
TRUNCATED=$(echo "$PROMPT" | head -c 500)

# Hash for dedup — SurrealDB will handle this, but avoid hitting it with identical rapid-fire prompts
CONTENT_HASH=$(echo "$TRUNCATED" | md5)

CONTENT_JSON=$(echo "$TRUNCATED" | /usr/bin/jq -R -s '.')
TAGS_JSON='["hook","interaction"]'

# Write to Anima (NS: anima, DB: memory)
# Uses SurrealDB HTTP API — upsert via content_hash to avoid duplication
curl -s -X POST \
  'http://127.0.0.1:8002/sql' \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' \
  -H 'surreal-db: memory' \
  -u 'root:root' \
  -d "$(cat <<EOF
SELECT count() FROM memories WHERE content_hash = '$CONTENT_HASH' AND deleted_at IS NONE
EOF
)" \
  > /tmp/anima_hook_check.json 2>/dev/null

# Only store if not already present (basic dedup without SHA256)
EXISTING=$(cat /tmp/anima_hook_check.json 2>/dev/null | /usr/bin/jq -r '.[0].result[0].count // 0' 2>/dev/null)
[ "$EXISTING" != "0" ] && exit 0

curl -s -X POST \
  'http://127.0.0.1:8002/sql' \
  -H 'Content-Type: application/json' \
  -H 'surreal-ns: anima' \
  -H 'surreal-db: memory' \
  -u 'root:root' \
  -d "CREATE memories SET
    content = $CONTENT_JSON,
    content_hash = '$CONTENT_HASH',
    resonance_phi = 0.5,
    confidence = 0.2,
    tier = 'active',
    tier_updated = time::now(),
    is_catalyst = false,
    access_count = 0,
    last_accessed = time::now(),
    session_ids = [],
    source = 'hook',
    origin = {harness: 'claude-code', harness_type: 'cli'},
    tags = $TAGS_JSON,
    created_at = time::now(),
    updated_at = time::now()" \
  > /dev/null 2>&1

exit 0
