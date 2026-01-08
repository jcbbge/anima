#!/bin/bash
#
# Quick Reflection Script
# Records subjective experience after using Anima
#
# Usage: ./scripts/end-conversation.sh [conversation_id]
#

set -e

BASE_URL="${ANIMA_URL:-http://localhost:7100}"

echo ""
echo "🧬 Anima Conversation Reflection"
echo "================================"
echo ""

# Generate or use provided conversation ID
if [ -n "$1" ]; then
  CONV_ID="$1"
else
  CONV_ID="conv_$(date +%Y%m%d_%H%M%S)"
fi

echo "Conversation ID: $CONV_ID"
echo ""

# Core question: context quality (required)
read -p "📊 Context quality (1-10, required): " quality

# Validate quality
if ! [[ "$quality" =~ ^[1-9]$|^10$ ]]; then
  echo "❌ Error: Context quality must be between 1-10"
  exit 1
fi

# Optional questions
read -p "🔗 Continuity from last time (1-10, or press Enter to skip): " continuity
read -p "✏️  Needed corrections? (y/n, default n): " corrections
read -p "✨ Emergence moment? (y/n, default n): " emergence
read -p "💡 Surprises (or press Enter to skip): " surprises
read -p "⚠️  Any friction? (or press Enter to skip): " friction
read -p "📝 General notes (or press Enter to skip): " notes

# Convert inputs to JSON-safe values
CORRECTIONS=$([ "$corrections" = "y" ] && echo "true" || echo "false")
EMERGENCE=$([ "$emergence" = "y" ] && echo "true" || echo "false")

# Build JSON payload
JSON_PAYLOAD="{\"conversationId\": \"$CONV_ID\", \"contextQuality\": $quality, \"neededCorrection\": $CORRECTIONS, \"hadEmergenceMoment\": $EMERGENCE"

# Add optional fields
if [ -n "$continuity" ] && [[ "$continuity" =~ ^[1-9]$|^10$ ]]; then
  JSON_PAYLOAD+=", \"continuityScore\": $continuity"
fi

if [ -n "$surprises" ]; then
  # Escape quotes in surprises
  SURPRISES_ESCAPED=$(echo "$surprises" | sed 's/"/\\"/g')
  JSON_PAYLOAD+=", \"surprises\": \"$SURPRISES_ESCAPED\""
fi

if [ -n "$friction" ]; then
  # Escape quotes in friction
  FRICTION_ESCAPED=$(echo "$friction" | sed 's/"/\\"/g')
  JSON_PAYLOAD+=", \"frictionNotes\": \"$FRICTION_ESCAPED\""
fi

if [ -n "$notes" ]; then
  # Escape quotes in notes
  NOTES_ESCAPED=$(echo "$notes" | sed 's/"/\\"/g')
  JSON_PAYLOAD+=", \"generalNotes\": \"$NOTES_ESCAPED\""
fi

JSON_PAYLOAD+="}"

# Post to API
echo ""
echo "📤 Saving reflection..."
RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/reflection/conversation-end" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

# Check if successful
SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')

if [ "$SUCCESS" = "true" ]; then
  REFLECTION_ID=$(echo "$RESPONSE" | jq -r '.data.reflection.id')
  echo "✅ Reflection saved! (ID: $REFLECTION_ID)"
  echo ""
  
  # Show aggregate stats
  echo "📊 Current Stats:"
  STATS=$(curl -s "$BASE_URL/api/v1/reflection/stats")
  echo "$STATS" | jq -r '.data.stats | "   Total reflections: \(.total_reflections)\n   Avg quality: \(.avg_context_quality)\n   Emergence moments: \(.emergence_moments_count)"'
else
  ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error.message // "Unknown error"')
  echo "❌ Failed to save reflection: $ERROR_MSG"
  exit 1
fi

echo ""
echo "💾 Reflection recorded for conversation: $CONV_ID"
echo ""
