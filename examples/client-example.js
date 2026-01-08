/**
 * Anima Client Example
 * 
 * Demonstrates how to use Anima from a JavaScript/TypeScript application.
 * 
 * Usage:
 *   bun examples/client-example.js
 */

const ANIMA_BASE_URL = process.env.ANIMA_URL || 'http://localhost:7100';

/**
 * Simple Anima client wrapper
 */
class AnimaClient {
  constructor(baseUrl = ANIMA_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async request(method, path, body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);
    const data = await response.json();

    if (!data.success) {
      throw new Error(`Anima Error: ${data.error.message}`);
    }

    return data.data;
  }

  // Memory operations
  async addMemory({ content, category, tags, source }) {
    return this.request('POST', '/api/v1/memories/add', {
      content,
      category,
      tags,
      source,
    });
  }

  async queryMemories({ 
    query, 
    limit = 20, 
    similarityThreshold = 0.7, 
    tiers, 
    conversationId 
  }) {
    return this.request('POST', '/api/v1/memories/query', {
      query,
      limit,
      similarityThreshold,
      tiers,
      conversationId,
    });
  }

  async bootstrap({ conversationId, limit = 50 }) {
    const params = new URLSearchParams({ conversationId, limit });
    return this.request('GET', `/api/v1/memories/bootstrap?${params}`);
  }

  async updateTier({ memoryId, tier, reason }) {
    return this.request('POST', '/api/v1/memories/update-tier', {
      memoryId,
      tier,
      reason,
    });
  }

  // Association operations
  async discoverAssociations({ memoryId, minStrength = 0.1, limit = 20 }) {
    const params = new URLSearchParams({ memoryId, minStrength, limit });
    return this.request('GET', `/api/v1/associations/discover?${params}`);
  }

  async findHubs({ limit = 10, minConnections = 5 } = {}) {
    const params = new URLSearchParams({ limit, minConnections });
    return this.request('GET', `/api/v1/associations/hubs?${params}`);
  }

  async getNetworkStats(memoryId) {
    const params = new URLSearchParams({ memoryId });
    return this.request('GET', `/api/v1/associations/network-stats?${params}`);
  }

  // Meta-cognitive operations
  async triggerReflection({ conversationId, sessionMetrics }) {
    return this.request('POST', '/api/v1/meta/conversation-end', {
      conversationId,
      sessionMetrics,
    });
  }

  async getReflections({ conversationId, limit = 1, reflectionType } = {}) {
    const params = new URLSearchParams();
    if (conversationId) params.append('conversationId', conversationId);
    if (limit) params.append('limit', limit);
    if (reflectionType) params.append('reflectionType', reflectionType);
    
    return this.request('GET', `/api/v1/meta/reflection?${params}`);
  }
}

/**
 * Example usage
 */
async function main() {
  const client = new AnimaClient();
  const conversationId = '550e8400-e29b-41d4-a716-446655440000';

  console.log('🧬 Anima Client Example');
  console.log('=======================\n');

  try {
    // 1. Add a memory
    console.log('1. Adding memory...');
    const memory = await client.addMemory({
      content: 'This is an example memory from the JavaScript client',
      category: 'example',
      tags: ['demo', 'client'],
      source: 'client-example',
    });
    console.log(`   ✓ Created memory: ${memory.memory.id}\n`);

    // 2. Query memories
    console.log('2. Querying memories...');
    const results = await client.queryMemories({
      query: 'example',
      limit: 5,
      similarityThreshold: 0.3,
      conversationId,
    });
    console.log(`   ✓ Found ${results.count} memories`);
    if (results.memories.length > 0) {
      console.log(`   Top result: "${results.memories[0].content.substring(0, 60)}..."`);
      console.log(`   Similarity: ${results.memories[0].similarity.toFixed(3)}\n`);
    }

    // 3. Bootstrap context
    console.log('3. Loading bootstrap context...');
    const bootstrap = await client.bootstrap({ 
      conversationId, 
      limit: 20 
    });
    console.log(`   ✓ Loaded ${bootstrap.distribution.total} memories`);
    console.log(`   Distribution: active=${bootstrap.distribution.active}, thread=${bootstrap.distribution.thread}, stable=${bootstrap.distribution.stable}\n`);

    // 4. Discover associations
    console.log('4. Discovering associations...');
    const associations = await client.discoverAssociations({
      memoryId: memory.memory.id,
      minStrength: 0.0,
      limit: 5,
    });
    console.log(`   ✓ Found ${associations.total_associations} associations\n`);

    // 5. Find hubs
    console.log('5. Finding hub memories...');
    const hubs = await client.findHubs({ limit: 3, minConnections: 3 });
    console.log(`   ✓ Found ${hubs.hubs.length} hub memories`);
    if (hubs.hubs.length > 0) {
      const topHub = hubs.hubs[0];
      console.log(`   Top hub: ${topHub.network_stats.total_connections} connections\n`);
    }

    // 6. Trigger reflection
    console.log('6. Generating reflection...');
    const reflection = await client.triggerReflection({
      conversationId,
      sessionMetrics: {
        memories_loaded: 20,
        memories_accessed: 18,
        context_load_time_ms: 120,
        queries_executed: 2,
        total_results_returned: 10,
        total_relevance_score: 7.5,
        relevant_results: 9,
      },
    });
    console.log(`   ✓ System feel: ${reflection.reflection.metrics.friction.feel}`);
    console.log(`   ✓ Hit rate: ${reflection.reflection.metrics.retrieval.hit_rate}`);
    console.log(`   Insights: ${reflection.reflection.insights.length}\n`);

    // 7. Retrieve reflection
    console.log('7. Retrieving reflection...');
    const reflections = await client.getReflections({ 
      conversationId, 
      limit: 1 
    });
    console.log(`   ✓ Retrieved ${reflections.count} reflection(s)\n`);

    console.log('✅ Example complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

// Export for use as a library
export { AnimaClient };
