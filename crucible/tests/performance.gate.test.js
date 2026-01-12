/**
 * THE CRUCIBLE: PERFORMANCE GATE VERIFICATION
 *
 * This module ensures production-level performance thresholds are maintained.
 * These are not "nice to have" targets - they are hard gates for production deployment.
 *
 * CRITICAL THRESHOLDS:
 * - Add Memory: < 150ms (P95)
 * - Query (20 memories): < 300ms (P95)
 * - Bootstrap (50 memories): < 200ms (P95)
 *
 * FORENSIC REQUIREMENTS:
 * - Report X-Response-Time header from API
 * - Report Cache Hit Rate for embeddings
 * - Provide statistical distribution (min, max, avg, p95)
 *
 * PURPOSE: Gate production deployments. If these thresholds are violated,
 *          the system is NOT production-ready and must be fixed.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { randomUUID } from 'node:crypto';

// API configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:7100';
const API_ENDPOINT = `${API_BASE_URL}/api/v1/memories`;

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
  addMemory: 150,
  query: 300,
  bootstrap: 200
};

// Number of samples for statistical confidence
const SAMPLE_SIZE = 10;

/**
 * Extract X-Response-Time header from response
 */
function extractResponseTime(headers) {
  const responseTime = headers.get('x-response-time');
  if (!responseTime) return null;

  // Parse "123ms" or "123.45ms" format
  const match = responseTime.match(/([\d.]+)ms/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Extract cache hit rate from response meta
 */
function extractCacheHitRate(responseMeta) {
  if (!responseMeta || !responseMeta.embeddingProvider) {
    return null;
  }

  // If provider is "cache", it's a cache hit
  return responseMeta.embeddingProvider === 'cache' ? 'HIT' : 'MISS';
}

/**
 * Calculate statistics from timing samples
 */
function calculateStats(samples) {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)]
  };
}

/**
 * Generate unique test memory content
 */
function generateTestMemory(index) {
  const timestamp = Date.now();
  const concepts = [
    'distributed systems coordination',
    'eventual consistency patterns',
    'cache invalidation strategies',
    'database query optimization',
    'API rate limiting algorithms',
    'memory management techniques',
    'concurrent request handling',
    'load balancing strategies',
    'microservice orchestration',
    'event-driven architecture'
  ];

  const concept = concepts[index % concepts.length];
  const uniqueId = Math.random().toString(36).substring(2, 8);

  return `Performance test ${index}: ${concept} [${uniqueId}-${timestamp}]`;
}

/**
 * Performance test: Add Memory
 */
async function testAddMemory(content) {
  const startTime = performance.now();

  const response = await fetch(`${API_ENDPOINT}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      category: 'performance-test',
      tags: ['crucible', 'performance-gate'],
      source: 'crucible-performance-gate'
    })
  });

  const endTime = performance.now();
  const clientLatency = endTime - startTime;

  if (!response.ok) {
    throw new Error(`Add memory failed: ${response.status}`);
  }

  const result = await response.json();
  const serverTime = extractResponseTime(response.headers);
  const cacheStatus = extractCacheHitRate(result.meta);

  return {
    success: result.success,
    memoryId: result.data.memory.id,
    clientLatency,
    serverTime,
    cacheStatus,
    headers: Object.fromEntries(response.headers.entries())
  };
}

/**
 * Performance test: Query Memories
 */
async function testQuery(query, limit = 20) {
  const startTime = performance.now();

  const response = await fetch(`${API_ENDPOINT}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit,
      similarityThreshold: 0.5
    })
  });

  const endTime = performance.now();
  const clientLatency = endTime - startTime;

  if (!response.ok) {
    throw new Error(`Query failed: ${response.status}`);
  }

  const result = await response.json();
  const serverTime = extractResponseTime(response.headers);
  const cacheStatus = extractCacheHitRate(result.meta);

  return {
    success: result.success,
    resultCount: result.data.count,
    clientLatency,
    serverTime,
    cacheStatus,
    queryTime: result.meta.queryTime,
    headers: Object.fromEntries(response.headers.entries())
  };
}

/**
 * Performance test: Bootstrap
 */
async function testBootstrap(conversationId, limit = 50) {
  const startTime = performance.now();

  const response = await fetch(
    `${API_ENDPOINT}/bootstrap?conversationId=${conversationId}&limit=${limit}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }
  );

  const endTime = performance.now();
  const clientLatency = endTime - startTime;

  if (!response.ok) {
    throw new Error(`Bootstrap failed: ${response.status}`);
  }

  const result = await response.json();
  const serverTime = extractResponseTime(response.headers);

  return {
    success: result.success,
    distribution: result.data.distribution,
    clientLatency,
    serverTime,
    headers: Object.fromEntries(response.headers.entries())
  };
}

describe('🛡️ THE CRUCIBLE: Performance Gate', () => {

  let testConversationId;

  beforeAll(async () => {
    testConversationId = randomUUID();
    console.log(`\n🔬 Performance Gate Verification`);
    console.log(`   Conversation ID: ${testConversationId}`);
    console.log(`   Sample size: ${SAMPLE_SIZE} iterations`);

    // Warmup Pulse Protocol: Clear the throat of API + Embedding service
    console.log(`\n🔥 Warmup Pulse Protocol: Priming the system...`);
    const warmupContent = generateTestMemory(999);
    const warmupResult = await testAddMemory(warmupContent);
    console.log(`   ✓ Add Memory warmup: ${warmupResult.serverTime || warmupResult.clientLatency}ms`);

    const warmupQuery = await testQuery('warmup query', 5);
    console.log(`   ✓ Query warmup: ${warmupQuery.serverTime || warmupQuery.clientLatency}ms`);

    const warmupBootstrap = await testBootstrap(randomUUID(), 10);
    console.log(`   ✓ Bootstrap warmup: ${warmupBootstrap.serverTime || warmupBootstrap.clientLatency}ms`);
    console.log(`   🔥 System primed. Beginning P95 measurement...\n`);
  });

  describe('GATE 1: Add Memory < 150ms', () => {

    test('P95 latency for add memory must be under threshold', async () => {
      console.log(`\n📊 Add Memory (${SAMPLE_SIZE} samples for P95):`);

      const samples = [];
      const cacheHits = { hit: 0, miss: 0 };

      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const content = generateTestMemory(i);
        const result = await testAddMemory(content);

        const latency = result.serverTime || result.clientLatency;
        samples.push(latency);

        if (result.cacheStatus === 'HIT') cacheHits.hit++;
        else if (result.cacheStatus === 'MISS') cacheHits.miss++;

        // Brief delay between samples to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const stats = calculateStats(samples);
      const cacheHitRate = ((cacheHits.hit / (cacheHits.hit + cacheHits.miss)) * 100).toFixed(1);

      console.log(`   Min: ${stats.min.toFixed(2)}ms`);
      console.log(`   Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`   P50: ${stats.p50.toFixed(2)}ms`);
      console.log(`   P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`   P99: ${stats.p99.toFixed(2)}ms`);
      console.log(`   Max: ${stats.max.toFixed(2)}ms`);
      console.log(`   Cache Hit Rate: ${cacheHitRate}% (${cacheHits.hit}/${cacheHits.hit + cacheHits.miss})`);

      if (stats.p95 > THRESHOLDS.addMemory) {
        console.error(`\n   ❌ P95 THRESHOLD VIOLATED: ${stats.p95.toFixed(2)}ms > ${THRESHOLDS.addMemory}ms`);
      } else {
        console.log(`\n   ✅ P95 within threshold: ${stats.p95.toFixed(2)}ms < ${THRESHOLDS.addMemory}ms`);
      }

      expect(stats.p95).toBeLessThan(THRESHOLDS.addMemory);
    }, 30000);
  });

  describe('GATE 2: Query (20 memories) < 300ms', () => {

    test('P95 latency for queries must be under threshold', async () => {
      console.log(`\n📊 Query (${SAMPLE_SIZE} samples for P95, limit=20):`);

      const queries = [
        'database optimization techniques',
        'API performance patterns',
        'caching strategies',
        'concurrent request handling',
        'memory management',
        'load balancing algorithms',
        'distributed system coordination',
        'event-driven architecture',
        'microservice patterns',
        'query optimization'
      ];

      const samples = [];
      const cacheHits = { hit: 0, miss: 0 };

      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const query = queries[i % queries.length];
        const result = await testQuery(query, 20);

        const latency = result.serverTime || result.clientLatency;
        samples.push(latency);

        if (result.cacheStatus === 'HIT') cacheHits.hit++;
        else if (result.cacheStatus === 'MISS') cacheHits.miss++;

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const stats = calculateStats(samples);
      const cacheHitRate = ((cacheHits.hit / (cacheHits.hit + cacheHits.miss)) * 100).toFixed(1);

      console.log(`   Min: ${stats.min.toFixed(2)}ms`);
      console.log(`   Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`   P50: ${stats.p50.toFixed(2)}ms`);
      console.log(`   P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`   P99: ${stats.p99.toFixed(2)}ms`);
      console.log(`   Max: ${stats.max.toFixed(2)}ms`);
      console.log(`   Cache Hit Rate: ${cacheHitRate}% (${cacheHits.hit}/${cacheHits.hit + cacheHits.miss})`);

      if (stats.p95 > THRESHOLDS.query) {
        console.error(`\n   ❌ P95 THRESHOLD VIOLATED: ${stats.p95.toFixed(2)}ms > ${THRESHOLDS.query}ms`);
      } else {
        console.log(`\n   ✅ P95 within threshold: ${stats.p95.toFixed(2)}ms < ${THRESHOLDS.query}ms`);
      }

      expect(stats.p95).toBeLessThan(THRESHOLDS.query);
    }, 30000);
  });

  describe('GATE 3: Bootstrap (50 memories) < 200ms', () => {

    test('P95 latency for bootstrap must be under threshold', async () => {
      console.log(`\n📊 Bootstrap (${SAMPLE_SIZE} samples for P95, limit=50):`);

      const samples = [];

      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const convId = randomUUID();
        const result = await testBootstrap(convId, 50);

        const latency = result.serverTime || result.clientLatency;
        samples.push(latency);

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const stats = calculateStats(samples);

      console.log(`   Min: ${stats.min.toFixed(2)}ms`);
      console.log(`   Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`   P50: ${stats.p50.toFixed(2)}ms`);
      console.log(`   P95: ${stats.p95.toFixed(2)}ms`);
      console.log(`   P99: ${stats.p99.toFixed(2)}ms`);
      console.log(`   Max: ${stats.max.toFixed(2)}ms`);

      if (stats.p95 > THRESHOLDS.bootstrap) {
        console.error(`\n   ❌ P95 THRESHOLD VIOLATED: ${stats.p95.toFixed(2)}ms > ${THRESHOLDS.bootstrap}ms`);
      } else {
        console.log(`\n   ✅ P95 within threshold: ${stats.p95.toFixed(2)}ms < ${THRESHOLDS.bootstrap}ms`);
      }

      expect(stats.p95).toBeLessThan(THRESHOLDS.bootstrap);
    }, 30000);
  });

  describe('Forensic Report Summary', () => {

    test('Generate comprehensive performance report', async () => {
      console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🛡️  PERFORMANCE GATE: FORENSIC SUMMARY`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      console.log(`Thresholds:`);
      console.log(`  Add Memory: < ${THRESHOLDS.addMemory}ms (P95)`);
      console.log(`  Query (20): < ${THRESHOLDS.query}ms (P95)`);
      console.log(`  Bootstrap (50): < ${THRESHOLDS.bootstrap}ms (P95)`);

      console.log(`\nForensic Data Captured:`);
      console.log(`  ✓ X-Response-Time headers from API`);
      console.log(`  ✓ Cache Hit Rate for embeddings`);
      console.log(`  ✓ Statistical distribution (min, avg, p50, p95, p99, max)`);
      console.log(`  ✓ ${SAMPLE_SIZE} samples per operation for P95 confidence`);

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // This test always passes - it's just for reporting
      expect(true).toBe(true);
    });
  });
});

// Export for reporter integration
export const testSummary = {
  module: 'Performance Gate',
  description: 'Production deployment gates for API performance',
  criticalTests: [
    'Add Memory: P95 < 150ms',
    'Query (20 memories): P95 < 300ms',
    'Bootstrap (50 memories): P95 < 200ms'
  ],
  thresholds: THRESHOLDS
};
