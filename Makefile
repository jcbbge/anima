# Anima Development Workflow
# ============================================================================
# Use this Makefile for seamless local development and testing

.PHONY: help dev-install test-install uninstall clean status sync

# Configuration
INSTALL_DIR := $(HOME)/.anima
BIN_DIR := $(HOME)/bin
CLI_NAME := anima

help: ## Show this help message
	@echo "Anima Development Workflow"
	@echo "=========================="
	@echo ""
	@echo "Commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""

status: ## Check installation status and sync state
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  Anima Installation Status"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@if [ -L "$(BIN_DIR)/$(CLI_NAME)" ]; then \
		echo "✅ CLI: Symlinked (dev mode)"; \
		echo "   $(BIN_DIR)/$(CLI_NAME) -> $$(readlink $(BIN_DIR)/$(CLI_NAME))"; \
	elif [ -f "$(BIN_DIR)/$(CLI_NAME)" ]; then \
		echo "⚠️  CLI: Regular file (production mode)"; \
		echo "   Location: $(BIN_DIR)/$(CLI_NAME)"; \
	else \
		echo "❌ CLI: Not installed"; \
	fi
	@echo ""
	@if [ -d "$(INSTALL_DIR)" ]; then \
		echo "✅ Anima directory: $(INSTALL_DIR)"; \
	else \
		echo "❌ Anima directory: Not found"; \
	fi
	@echo ""
	@if [ -L "$(BIN_DIR)/$(CLI_NAME)" ]; then \
		if diff -q "$(BIN_DIR)/$(CLI_NAME)" "$(INSTALL_DIR)/cli/$(CLI_NAME)" > /dev/null 2>&1; then \
			echo "✅ Sync: CLI is up to date"; \
		else \
			echo "⚠️  Sync: Files differ"; \
		fi; \
	fi
	@echo ""

dev-install: ## Install CLI as symlink for live development
	@echo "🔧 Installing in DEV mode (symlink)..."
	@mkdir -p $(BIN_DIR)
	@if [ -f "$(BIN_DIR)/$(CLI_NAME)" ] && [ ! -L "$(BIN_DIR)/$(CLI_NAME)" ]; then \
		echo "⚠️  Removing existing production installation..."; \
		rm -f $(BIN_DIR)/$(CLI_NAME); \
	fi
	@ln -sf $(INSTALL_DIR)/cli/$(CLI_NAME) $(BIN_DIR)/$(CLI_NAME)
	@chmod +x $(INSTALL_DIR)/cli/$(CLI_NAME)
	@echo "✅ CLI symlinked: $(BIN_DIR)/$(CLI_NAME) -> $(INSTALL_DIR)/cli/$(CLI_NAME)"
	@echo ""
	@echo "You can now edit cli/anima and changes take effect immediately!"
	@echo "Test with: anima bootstrap"

prod-install: ## Install CLI as regular file (production mode)
	@echo "📦 Installing in PRODUCTION mode (copy)..."
	@mkdir -p $(BIN_DIR)
	@if [ -L "$(BIN_DIR)/$(CLI_NAME)" ]; then \
		echo "⚠️  Removing existing dev installation..."; \
		rm -f $(BIN_DIR)/$(CLI_NAME); \
	fi
	@cp $(INSTALL_DIR)/cli/$(CLI_NAME) $(BIN_DIR)/$(CLI_NAME)
	@chmod +x $(BIN_DIR)/$(CLI_NAME)
	@echo "✅ CLI installed: $(BIN_DIR)/$(CLI_NAME)"
	@echo ""
	@echo "Run 'make sync' after making changes to update the installation."

sync: ## Sync repo CLI to installed version (for production mode)
	@if [ ! -L "$(BIN_DIR)/$(CLI_NAME)" ]; then \
		echo "🔄 Syncing CLI to $(BIN_DIR)/$(CLI_NAME)..."; \
		cp $(INSTALL_DIR)/cli/$(CLI_NAME) $(BIN_DIR)/$(CLI_NAME); \
		chmod +x $(BIN_DIR)/$(CLI_NAME); \
		echo "✅ CLI synced"; \
	else \
		echo "⚠️  CLI is symlinked (dev mode) - no sync needed"; \
		echo "Changes are already live!"; \
	fi

test-flow: ## Test the complete Docker detection and startup flow
	@echo "🧪 Testing ignition sequence..."
	@echo ""
	@echo "Prerequisites:"
	@echo "  1. Docker Desktop should be stopped"
	@echo "  2. You'll be prompted to start it"
	@echo ""
	@read -p "Press Enter to continue..." dummy
	@$(BIN_DIR)/$(CLI_NAME) bootstrap

test-services: ## Check if Anima services are running
	@echo "🔍 Checking Anima services..."
	@if curl -sf http://localhost:7100/health > /dev/null 2>&1; then \
		echo "✅ Anima API is running (http://localhost:7100)"; \
		curl -s http://localhost:7100/health | jq '.'; \
	else \
		echo "❌ Anima API is not responding"; \
		echo "   Try: make test-flow"; \
	fi

stop-services: ## Stop all Anima Docker services
	@echo "🛑 Stopping Anima services..."
	@cd $(INSTALL_DIR) && docker compose down
	@echo "✅ Services stopped"

start-services: ## Start Anima Docker services manually
	@echo "🚀 Starting Anima services..."
	@cd $(INSTALL_DIR) && docker compose up -d
	@echo "⏳ Waiting for services to be ready..."
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:7100/health > /dev/null 2>&1; then \
			echo "✅ Services ready!"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "⚠️  Services started but not responding yet"

logs: ## View Anima service logs
	@cd $(INSTALL_DIR) && docker compose logs -f

uninstall: ## Remove CLI and services (keeps database)
	@echo "🗑️  Uninstalling Anima..."
	@rm -f $(BIN_DIR)/$(CLI_NAME)
	@cd $(INSTALL_DIR) && docker compose down
	@echo "✅ Uninstalled (database preserved)"
	@echo ""
	@echo "To remove everything including data:"
	@echo "  cd $(INSTALL_DIR) && docker compose down -v"
	@echo "  rm -rf $(INSTALL_DIR)"

clean: ## Clean up Docker resources
	@echo "🧹 Cleaning up Docker resources..."
	@cd $(INSTALL_DIR) && docker compose down -v
	@echo "✅ Docker volumes removed"

# Development workflow summary
dev-workflow: ## Show recommended development workflow
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  Recommended Development Workflow"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo ""
	@echo "1. Set up dev mode (one time):"
	@echo "   make dev-install"
	@echo ""
	@echo "2. Make changes to cli/anima"
	@echo "   (Changes are live immediately with symlink!)"
	@echo ""
	@echo "3. Test your changes:"
	@echo "   make test-flow"
	@echo ""
	@echo "4. Check status:"
	@echo "   make status"
	@echo ""
	@echo "5. Before pushing to GitHub:"
	@echo "   - Verify git status shows your changes"
	@echo "   - Test with: make test-flow"
	@echo "   - Commit and push"
	@echo ""
	@echo "6. When ready to switch back to production:"
	@echo "   make prod-install"
	@echo ""
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
