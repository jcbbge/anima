/**
 * Global Test Teardown
 *
 * Closes the shared test database pool after all tests complete.
 */

import { closeTestPool } from './testDatabase.js';

export default async function globalTeardown() {
  console.log('\n🔒 Closing test database pool...');
  await closeTestPool();
  console.log('✅ Test database pool closed\n');
}
