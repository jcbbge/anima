#!/bin/bash
#
# Basic Workflow Example
# Demonstrates core Anima operations: add, query, bootstrap
#

set -e

BASE_URL="http://localhost:7100"
CONVERSATION_ID="550e8400-e29b-41d4-a716-446655440000"

echo "🧬 Anima Basic Workflow Example"
echo "================================"
echo ""

# Check health
echo "1. Checking API health..."
curl -s "$BASE_URL/health" | jq '.status'
echo ""

# Add memories
echo "2. Adding memories..."

MEMORY1=$(curl -s -X POST "$BASE_URL/api/v1/memories/add" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Josh is building Anima, a consciousness substrate for AI assistants",
    "category": "project",
    "tags": ["anima", "consciousness"]
  }' | jq -r '.data.memory.id')

echo "   ✓ Added memory 1: $MEMORY1"

MEMORY2=$(curl -s -X POST "$BASE_URL/api/v1/memories/add" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Anima V1 uses PostgreSQL with pgvector for semantic search",
    "category": "technical",
    "tags": ["anima", "database"]
  }' | jq -r '.data.memory.id')

echo "   ✓ Added memory 2: $MEMORY2"

MEMORY3=$(curl -s -X POST "$BASE_URL/api/v1/memories/add" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "The tier system promotes memories from active to thread to stable",
    "category": "design",
    "tags": ["anima", "tiers"]
  }' | jq -r '.data.memory.id')

echo "   ✓ Added memory 3: $MEMORY3"
echo ""

# Query memories
echo "3. Querying memories..."
QUERY_RESULT=$(curl -s -X POST "$BASE_URL/api/v1/memories/query" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is Anima?",
    "limit": 10,
    "similarityThreshold": 0.3,
    "conversationId": "'"$CONVERSATION_ID"'"
  }')

RESULT_COUNT=$(echo "$QUERY_RESULT" | jq '.data.count')
echo "   Found $RESULT_COUNT memories"
echo ""

# Show top result
echo "4. Top search result:"
echo "$QUERY_RESULT" | jq '.data.memories[0] | {
  content: .content[0:80] + "...",
  similarity: .similarity,
  tier: .tier
}'
echo ""

# Bootstrap context
echo "5. Loading bootstrap context..."
BOOTSTRAP=$(curl -s "$BASE_URL/api/v1/memories/bootstrap?conversationId=$CONVERSATION_ID&limit=20")

echo "   Distribution:"
echo "$BOOTSTRAP" | jq '.data.distribution'
echo ""

# Find associations
echo "6. Discovering associations for first memory..."
ASSOCIATIONS=$(curl -s "$BASE_URL/api/v1/associations/discover?memoryId=$MEMORY1&minStrength=0.0&limit=5")

ASSOC_COUNT=$(echo "$ASSOCIATIONS" | jq '.data.total_associations')
echo "   Found $ASSOC_COUNT associations"

if [ "$ASSOC_COUNT" -gt 0 ]; then
  echo "   Top association:"
  echo "$ASSOCIATIONS" | jq '.data.associations[0] | {
    content: .associated_content[0:60] + "...",
    strength: .strength,
    co_occurrences: .co_occurrence_count
  }'
fi
echo ""

# Trigger reflection
echo "7. Generating reflection..."
REFLECTION=$(curl -s -X POST "$BASE_URL/api/v1/meta/conversation-end" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "'"$CONVERSATION_ID"'",
    "sessionMetrics": {
      "memories_loaded": 20,
      "memories_accessed": 18,
      "context_load_time_ms": 120,
      "queries_executed": 3,
      "total_results_returned": 30,
      "total_relevance_score": 21.5,
      "relevant_results": 25
    }
  }')

echo "   System feel: $(echo "$REFLECTION" | jq -r '.data.reflection.metrics.friction.feel')"
echo "   Hit rate: $(echo "$REFLECTION" | jq -r '.data.reflection.metrics.retrieval.hit_rate')"
echo ""
echo "   Insights:"
echo "$REFLECTION" | jq -r '.data.reflection.insights[] | "   - " + .'
echo ""

echo "✅ Workflow complete!"
echo ""
echo "Next steps:"
echo "  - View full API docs: docs/API.md"
echo "  - Check reflection details: curl \"$BASE_URL/api/v1/meta/reflection?conversationId=$CONVERSATION_ID\""
echo "  - Find hub memories: curl \"$BASE_URL/api/v1/associations/hubs?limit=5\""
