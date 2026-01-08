# Anima Examples

This directory contains example scripts and client code demonstrating how to use Anima.

## Prerequisites

Make sure Anima is running:

```bash
# From the project root
./setup.sh
bun dev
```

The API should be available at `http://localhost:7100`.

## Examples

### 1. Basic Workflow (Bash)

**File**: `basic-workflow.sh`

Demonstrates core operations using curl commands:
- Health check
- Adding memories
- Querying with semantic search
- Bootstrap context loading
- Association discovery
- Reflection generation

**Run**:
```bash
chmod +x examples/basic-workflow.sh
./examples/basic-workflow.sh
```

**Output**: Step-by-step workflow with JSON results

---

### 2. JavaScript Client (Bun/Node.js)

**File**: `client-example.js`

Shows how to use Anima from JavaScript/TypeScript applications with a reusable client class.

**Run**:
```bash
bun examples/client-example.js
```

**Features**:
- `AnimaClient` wrapper class
- All API methods wrapped with clean interface
- Error handling
- TypeScript-friendly (works with Bun or Node.js)

**Use in your code**:
```javascript
import { AnimaClient } from './examples/client-example.js';

const client = new AnimaClient('http://localhost:7100');

// Add a memory
const memory = await client.addMemory({
  content: 'Your memory here',
  category: 'example',
  tags: ['tag1', 'tag2']
});

// Query memories
const results = await client.queryMemories({
  query: 'search term',
  limit: 10,
  similarityThreshold: 0.7
});
```

---

## Common Patterns

### Store and Retrieve

```bash
# Store
curl -X POST http://localhost:7100/api/v1/memories/add \
  -H "Content-Type: application/json" \
  -d '{"content": "Your content here"}'

# Retrieve
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{"query": "search term", "limit": 10}'
```

### Conversation Lifecycle

```bash
# 1. Bootstrap at conversation start
curl "http://localhost:7100/api/v1/memories/bootstrap?conversationId=<uuid>&limit=30"

# 2. Query during conversation
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{"query": "...", "conversationId": "<uuid>"}'

# 3. Reflection at conversation end
curl -X POST http://localhost:7100/api/v1/meta/conversation-end \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "<uuid>", "sessionMetrics": {...}}'
```

### Network Analysis

```bash
# Find hubs
curl "http://localhost:7100/api/v1/associations/hubs?limit=10&minConnections=5"

# Discover associations
curl "http://localhost:7100/api/v1/associations/discover?memoryId=<uuid>&minStrength=0.2"

# Get network stats
curl "http://localhost:7100/api/v1/associations/network-stats?memoryId=<uuid>"
```

## Environment Variables

Set `ANIMA_URL` to use a different Anima instance:

```bash
export ANIMA_URL=http://your-anima-instance:7100
./examples/basic-workflow.sh
```

## Next Steps

- Read the full [API Documentation](../docs/API.md)
- Check [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines
- Explore the [Architecture Documentation](../docs/ARCHITECTURE.md) (coming soon)

## Troubleshooting

### "Connection refused"
Make sure Anima is running:
```bash
curl http://localhost:7100/health
```

If not running, start it:
```bash
bun dev
```

### "Docker not running"
Start Docker Desktop and run setup:
```bash
./setup.sh
```

### "No results found"
Try lowering the similarity threshold:
```bash
curl -X POST http://localhost:7100/api/v1/memories/query \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "similarityThreshold": 0.3}'
```

## Contributing Examples

Have a useful example? Contributions welcome!

1. Add your example to this directory
2. Update this README
3. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
