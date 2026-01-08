/**
 * Content Hashing Utilities
 * 
 * SHA-256 hashing for memory content deduplication.
 */

import crypto from 'crypto';

/**
 * Generate SHA-256 hash of content
 * 
 * @param {string} content - Content to hash
 * @returns {string} Hex-encoded SHA-256 hash
 */
export function generateHash(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Content must be a non-empty string');
  }

  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
}
