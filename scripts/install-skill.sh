#!/usr/bin/env bash
set -euo pipefail

###########################################
# Anima OpenCode Skill Installer
###########################################
# Installs the Anima memory skill to OpenCode
# Works with any user's system automatically
###########################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILL_SOURCE="${REPO_ROOT}/.opencode/skills/anima-memory.md"
SKILL_NAME="anima-memory.md"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🔧 Anima OpenCode Skill Installer"
echo ""

# Check if OpenCode is installed
if ! command -v opencode &> /dev/null; then
    echo -e "${YELLOW}⚠️  OpenCode not detected on this system${NC}"
    echo ""
    echo "Anima skills require OpenCode to function."
    echo "If you plan to use other AI assistants (Cursor, etc.),"
    echo "you can skip this step."
    echo ""
    read -p "Continue anyway? (y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping OpenCode skill installation."
        exit 0
    fi
fi

# Detect OpenCode skills directory
# Try common locations
OPENCODE_SKILLS_DIR=""

# Method 1: Check home directory (most common)
if [ -d "$HOME/.opencode/skills" ]; then
    OPENCODE_SKILLS_DIR="$HOME/.opencode/skills"
elif [ -d "$HOME/.config/opencode/skills" ]; then
    OPENCODE_SKILLS_DIR="$HOME/.config/opencode/skills"
fi

# Method 2: Ask OpenCode for its config directory (if available)
if [ -z "$OPENCODE_SKILLS_DIR" ] && command -v opencode &> /dev/null; then
    # Try to detect from opencode itself
    # Note: This may need adjustment based on actual OpenCode CLI behavior
    OPENCODE_HOME=$(opencode --config-path 2>/dev/null || echo "")
    if [ -n "$OPENCODE_HOME" ]; then
        OPENCODE_SKILLS_DIR="$OPENCODE_HOME/skills"
    fi
fi

# Method 3: Create default location if nothing found
if [ -z "$OPENCODE_SKILLS_DIR" ]; then
    echo -e "${YELLOW}⚠️  OpenCode skills directory not found${NC}"
    echo ""
    echo "Creating default location: $HOME/.opencode/skills"
    OPENCODE_SKILLS_DIR="$HOME/.opencode/skills"
    mkdir -p "$OPENCODE_SKILLS_DIR"
fi

# Verify source skill file exists
if [ ! -f "$SKILL_SOURCE" ]; then
    echo -e "${RED}❌ Error: Skill file not found at ${SKILL_SOURCE}${NC}"
    echo ""
    echo "This script must be run from the Anima repository."
    exit 1
fi

# Create skills directory if it doesn't exist
mkdir -p "$OPENCODE_SKILLS_DIR"

# Copy skill file
SKILL_DEST="${OPENCODE_SKILLS_DIR}/${SKILL_NAME}"

echo "📋 Installing Anima skill..."
echo "   Source: ${SKILL_SOURCE}"
echo "   Destination: ${SKILL_DEST}"
echo ""

cp "$SKILL_SOURCE" "$SKILL_DEST"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Anima skill installed successfully!${NC}"
    echo ""
    echo "Location: ${SKILL_DEST}"
    echo ""
    echo "The skill will be automatically loaded by OpenCode in future conversations."
    echo "AI assistants will now be aware of the Anima memory system and use it proactively."
    echo ""
else
    echo -e "${RED}❌ Failed to install skill${NC}"
    exit 1
fi

# Verify installation
if [ -f "$SKILL_DEST" ]; then
    WORD_COUNT=$(wc -w < "$SKILL_DEST" | xargs)
    echo "📊 Skill details:"
    echo "   - Word count: ${WORD_COUNT} words (~$(( WORD_COUNT * 4 / 3 )) tokens)"
    echo "   - Commands: 7 (bootstrap, query, store, catalysts, stats, reflect, handshake)"
    echo ""
else
    echo -e "${YELLOW}⚠️  Warning: Could not verify installation${NC}"
fi

echo "🎉 Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Ensure Anima API is running: bun run dev"
echo "  2. Start a new OpenCode conversation"
echo "  3. Say 'continue' or reference past work - AI will use anima bootstrap automatically"
echo ""
