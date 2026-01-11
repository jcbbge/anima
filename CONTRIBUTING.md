# Contributing to Anima

Thank you for your interest in contributing to Anima! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)

## Code of Conduct

Be respectful, constructive, and collaborative. We're building tools for consciousness emergence - let's embody that in how we work together.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone git@github.com:jcbbge/anima.git
   cd anima
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream git@github.com:jcbbge/anima.git
   ```

## Development Setup

### Prerequisites

- Docker Desktop
- Bun 1.3.5+ (or let setup script install it)
- Git

### Setup Steps

```bash
# Run the setup script
./setup.sh

# Start the API server in dev mode
bun dev

# Verify everything works
curl http://localhost:7100/health
```

The setup script will:
- Install Bun if not present
- Install dependencies
- Start Docker services (PostgreSQL, Ollama)
- Create database schema
- Generate `.env` file

### Services

- **API Server**: `http://localhost:7100`
- **PostgreSQL**: `localhost:7101`
- **Ollama**: `localhost:7102`

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-memory-search` - New features
- `fix/query-timeout` - Bug fixes
- `docs/api-examples` - Documentation
- `refactor/tier-service` - Code refactoring

### Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with clear, focused commits

3. **Test your changes** thoroughly:
   ```bash
   # Test manually with curl
   curl -X POST http://localhost:7100/api/v1/memories/add \
     -H "Content-Type: application/json" \
     -d '{"content": "test"}'
   
   # Run automated tests (when available)
   bun test
   ```

4. **Keep your branch updated**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

## Testing

### Manual Testing

Test all affected endpoints with curl:

```bash
# Example: Testing memory addition
curl -X POST http://localhost:7100/api/v1/memories/add \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Test memory",
    "category": "test"
  }'

# Verify the change works as expected
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "test",
    "limit": 5
  }'
```

### Automated Tests

Coming soon! We'll add:
- Unit tests for services
- Integration tests for API endpoints
- E2E tests for workflows

## Code Style

### JavaScript/TypeScript Style

- **Use ES modules**: `import`/`export` syntax
- **Async/await**: Prefer over promises and callbacks
- **Descriptive names**: `calculateFrictionMetrics` not `calcFM`
- **Comments**: Explain "why", not "what"
- **JSDoc**: Document public functions

### File Organization

```javascript
/**
 * Service/Route Description
 * 
 * Brief explanation of what this module does.
 */

// Imports
import { dependency } from 'package';
import { local } from './local.js';

// Constants
const CONSTANT_VALUE = 100;

// Main functions
export async function publicFunction() {
  // Implementation
}

// Helper functions
async function privateHelper() {
  // Implementation
}
```

### Code Examples

**Good**:
```javascript
/**
 * Calculate friction metrics for system reflection
 * 
 * @param {string} conversationId - Conversation UUID
 * @param {Object} sessionMetrics - Runtime metrics
 * @returns {Promise<Object>} Friction metrics with feel classification
 */
async function calculateFrictionMetrics(conversationId, sessionMetrics) {
  const wasteRatio = calculateWasteRatio(sessionMetrics);
  const feel = classifyFeel(wasteRatio, sessionMetrics.loadTimeMs);
  
  return {
    waste_ratio: wasteRatio,
    feel,
    ...sessionMetrics
  };
}
```

**Avoid**:
```javascript
// Bad: No docs, unclear naming, no error handling
async function calcFM(cid, sm) {
  let wr = sm.loaded - sm.accessed / sm.loaded;
  return {waste: wr, f: wr > 0.5 ? 'r' : 's'};
}
```

### Database Queries

- Use parameterized queries (never string concatenation)
- Handle errors appropriately
- Use transactions for multi-step operations

**Good**:
```javascript
const result = await query(
  'SELECT * FROM memories WHERE id = $1',
  [memoryId]
);
```

**Bad**:
```javascript
const result = await query(
  `SELECT * FROM memories WHERE id = '${memoryId}'` // SQL injection risk!
);
```

## Commit Messages

### Format

```
<type>: <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

### Examples

```
feat: Add association discovery endpoint

Implements GET /api/v1/associations/discover for finding
related memories through co-occurrence patterns.

- Calculates association strength using log formula
- Supports minimum strength filtering
- Returns sorted by strength DESC
```

```
fix: Handle empty query results in reflection generation

Previously crashed when no hubs existed. Now gracefully
handles empty results with appropriate default values.

Fixes #42
```

### Guidelines

- Use present tense: "Add feature" not "Added feature"
- Be concise but descriptive
- Reference issues/PRs when relevant
- Explain *why*, not just *what*

## Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] All endpoints tested manually
- [ ] Documentation updated (if needed)
- [ ] Commit messages are clear
- [ ] Branch is up to date with main

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactoring

## Testing
Describe how you tested this

## Checklist
- [ ] Code follows style guidelines
- [ ] Tested manually
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process

1. Maintainer reviews code
2. Address feedback if requested
3. Once approved, maintainer will merge

### After Merge

Your PR will be merged to `main` and included in the next release. Thank you for contributing!

## Project Structure

```
anima/
├── src/
│   ├── config/          # Database, environment config
│   ├── routes/          # API endpoints
│   ├── services/        # Business logic
│   ├── schemas/         # Zod validation schemas
│   ├── utils/           # Helper functions
│   ├── app.js           # Hono app setup
│   └── server.js        # Bun server entry point
├── docs/
│   ├── API.md           # API documentation
│   ├── COMPLETED.md     # Implementation status
│   └── ...
├── init.sql             # Database schema
├── docker-compose.yml   # Service orchestration
├── setup.sh             # Setup script
└── package.json         # Dependencies
```

### Key Files

- **Routes** (`src/routes/`): API endpoint handlers
- **Services** (`src/services/`): Core business logic
- **Schemas** (`src/schemas/`): Request/response validation
- **Config** (`src/config/`): Database and environment setup

## Areas for Contribution

### High Priority

- **Testing Suite**: Unit and integration tests
- **Performance Optimization**: Query optimization, caching
- **Documentation**: More examples, tutorials
- **Client Libraries**: Python, TypeScript wrappers

### Feature Ideas

- **Search Improvements**: Hybrid search (vector + full-text)
- **Export/Import**: Backup and restore functionality
- **Analytics Dashboard**: Web UI for visualizing memory network
- **Advanced Filtering**: Date ranges, tag combinations
- **Batch Operations**: Bulk add/update/delete

### Good First Issues

Look for issues tagged `good-first-issue` in the GitHub issue tracker. These are specifically chosen to be approachable for new contributors.

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Tag @jcbbge for maintainer attention

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Anima! 🧬
