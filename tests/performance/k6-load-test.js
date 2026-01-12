import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export let options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '2m', target: 50 },   // Stay at 50 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'], // 95% of requests under 400ms
    errors: ['rate<0.01'],            // Error rate under 1%
  },
};

const BASE_URL = 'http://localhost:7100/api/v1';

export default function () {
  // Scenario 1: Add memory (20% of traffic)
  if (Math.random() < 0.2) {
    const addResponse = http.post(`${BASE_URL}/memories/add`, JSON.stringify({
      content: `Test memory ${Date.now()}-${__VU}-${__ITER}`,
      category: 'test',
      tags: ['performance', 'load-test']
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

    const addSuccess = check(addResponse, {
      'add status is 201': (r) => r.status === 201,
      'add response time < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!addSuccess);
  }

  // Scenario 2: Query memories (60% of traffic)
  if (Math.random() < 0.6) {
    const queries = [
      'performance optimization',
      'memory system',
      'vector search',
      'database indexing',
      'semantic search'
    ];
    const randomQuery = queries[Math.floor(Math.random() * queries.length)];

    const queryResponse = http.post(`${BASE_URL}/memories/query`, JSON.stringify({
      query: randomQuery,
      limit: 20,
      conversationId: `test-${__VU}`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

    const querySuccess = check(queryResponse, {
      'query status is 200': (r) => r.status === 200,
      'query response time < 400ms': (r) => r.timings.duration < 400,
    });

    errorRate.add(!querySuccess);
  }

  // Scenario 3: Bootstrap (20% of traffic)
  if (Math.random() < 0.2) {
    const bootstrapResponse = http.get(
      `${BASE_URL}/memories/bootstrap?conversationId=test-${__VU}-${__ITER}`
    );

    const bootstrapSuccess = check(bootstrapResponse, {
      'bootstrap status is 200': (r) => r.status === 200,
      'bootstrap response time < 250ms': (r) => r.timings.duration < 250,
    });

    errorRate.add(!bootstrapSuccess);
  }

  sleep(1); // 1 second between requests per user
}
