/**
 * Memory Validation Schemas
 * 
 * Zod schemas for validating memory-related requests.
 * Provides type-safe validation with clear error messages.
 */

import { z } from 'zod';

/**
 * Schema for adding a new memory
 */
export const addMemorySchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(50000, 'Content cannot exceed 50,000 characters'),
  
  category: z
    .string()
    .min(1)
    .max(100)
    .optional(),
  
  tags: z
    .array(z.string().min(1).max(50))
    .max(20, 'Maximum 20 tags allowed')
    .optional(),
  
  source: z
    .string()
    .min(1)
    .max(100)
    .optional(),
  
  isCatalyst: z
    .boolean()
    .optional()
    .default(false),
});

/**
 * Schema for querying memories
 */
export const queryMemoriesSchema = z.object({
  query: z
    .string()
    .min(1, 'Query cannot be empty')
    .max(5000, 'Query cannot exceed 5,000 characters'),

  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20),

  similarityThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.7),

  tiers: z
    .array(z.enum(['active', 'thread', 'stable', 'network']))
    .optional(),

  conversationId: z
    .string()
    .optional(),
});

/**
 * Schema for bootstrap endpoint (query params)
 */
export const bootstrapSchema = z.object({
  conversationId: z
    .string()
    .optional(),

  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(200))
    .default('50'),

  includeActive: z
    .string()
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .default('true'),

  includeThread: z
    .string()
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .default('true'),

  includeStable: z
    .string()
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .default('true'),
});

/**
 * Schema for updating memory tier
 */
export const updateTierSchema = z.object({
  memoryId: z
    .string()
    .uuid('Memory ID must be a valid UUID'),
  
  tier: z
    .enum(['active', 'thread', 'stable', 'network'], {
      errorMap: () => ({ message: 'Tier must be one of: active, thread, stable, network' })
    }),
  
  reason: z
    .string()
    .min(1)
    .max(200)
    .optional(),
});

/**
 * Common response metadata schema
 */
export const responseMetaSchema = z.object({
  requestId: z.string().uuid(),
  timestamp: z.string().datetime(),
  duration: z.number().optional(),
});

/**
 * Success response wrapper
 */
export const successResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  meta: responseMetaSchema,
});

/**
 * Error response wrapper
 */
export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
  meta: responseMetaSchema.optional(),
});

/**
 * Schema for discovering associations (query params)
 */
export const discoverAssociationsSchema = z.object({
  memoryId: z
    .string()
    .uuid('Memory ID must be a valid UUID'),
  
  minStrength: z
    .string()
    .transform(Number)
    .pipe(z.number().min(0).max(1))
    .default('0.1'),
  
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(100))
    .default('20'),
});

/**
 * Schema for finding hub memories (query params)
 */
export const findHubsSchema = z.object({
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(50))
    .default('10'),
  
  minConnections: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('5'),
});

/**
 * Schema for getting network stats (query params)
 */
export const networkStatsSchema = z.object({
  memoryId: z
    .string()
    .uuid('Memory ID must be a valid UUID'),
});

/**
 * Schema for recording conversation reflection
 */
export const conversationReflectionSchema = z.object({
  conversationId: z
    .string()
    .min(1, 'Conversation ID is required')
    .max(200),
  
  contextQuality: z
    .number()
    .int()
    .min(1, 'Context quality must be between 1-10')
    .max(10, 'Context quality must be between 1-10')
    .optional(),
  
  continuityScore: z
    .number()
    .int()
    .min(1, 'Continuity score must be between 1-10')
    .max(10, 'Continuity score must be between 1-10')
    .optional(),
  
  neededCorrection: z
    .boolean()
    .optional()
    .default(false),
  
  hadEmergenceMoment: z
    .boolean()
    .optional()
    .default(false),
  
  surprises: z
    .string()
    .max(1000)
    .optional(),
  
  frictionNotes: z
    .string()
    .max(1000)
    .optional(),
  
  generalNotes: z
    .string()
    .max(2000)
    .optional(),
});

/**
 * Schema for getting reflections (query params)
 */
export const getConversationReflectionsSchema = z.object({
  conversationId: z
    .string()
    .optional(),
  
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(100))
    .default('10'),
  
  minQuality: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(1).max(10))
    .optional(),
});

/**
 * Schema for triggering conversation-end reflection
 */
export const conversationEndSchema = z.object({
  conversationId: z
    .string()
    .uuid('Conversation ID must be a valid UUID'),
  
  sessionMetrics: z.object({
    memories_loaded: z.number().int().nonnegative().optional(),
    memories_accessed: z.number().int().nonnegative().optional(),
    context_load_time_ms: z.number().nonnegative().optional(),
    queries_executed: z.number().int().nonnegative().optional(),
    total_results_returned: z.number().int().nonnegative().optional(),
    total_relevance_score: z.number().nonnegative().optional(),
    relevant_results: z.number().int().nonnegative().optional(),
  }).optional(),
});

/**
 * Schema for getting reflections (query params)
 */
export const getReflectionsSchema = z.object({
  conversationId: z
    .string()
    .uuid('Conversation ID must be a valid UUID')
    .optional(),
  
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(50))
    .default('1'),
  
  reflectionType: z
    .enum(['conversation_end', 'weekly', 'manual'])
    .optional(),
});
