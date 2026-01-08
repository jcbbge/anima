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
    .uuid('Conversation ID must be a valid UUID')
    .optional(),
});

/**
 * Schema for bootstrap context loading (query params)
 */
export const bootstrapSchema = z.object({
  conversationId: z
    .string()
    .uuid('Conversation ID must be a valid UUID'),
  
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
