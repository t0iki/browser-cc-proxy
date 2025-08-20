import { z } from 'zod';

// Tool Input Schemas
export const ListTargetsInputSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().default(9222),
  filterUrlIncludes: z.string().optional(),
  types: z.array(z.string()).optional()
});

export const ObserveInputSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().default(9222),
  targetId: z.string().optional(),
  urlIncludes: z.string().optional(),
  includeWorkers: z.boolean().default(true),
  includeIframes: z.boolean().default(true),
  bufferSize: z.number().optional(),
  ttlSec: z.number().optional()
}).refine(data => data.targetId || data.urlIncludes, {
  message: "Either targetId or urlIncludes must be provided"
});

export const StopObserveInputSchema = z.object({
  targetId: z.string(),
  dropBuffer: z.boolean().default(false)
});

export const ReadEventsInputSchema = z.object({
  targetId: z.string(),
  offset: z.number().default(0),
  limit: z.number().default(200),
  kinds: z.array(z.enum([
    'console', 'log', 'request', 'response', 
    'loadingFinished', 'loadingFailed', 'websocket', 'other'
  ])).optional(),
  urlIncludes: z.string().optional(),
  method: z.string().optional()
});

export const ClearEventsInputSchema = z.object({
  targetId: z.string()
});

export const GetResponseBodyInputSchema = z.object({
  targetId: z.string(),
  requestId: z.string(),
  base64: z.boolean().default(false)
});

export const SetFiltersInputSchema = z.object({
  targetId: z.string(),
  kinds: z.array(z.enum(['console', 'log', 'network'])).optional(),
  urlAllowlist: z.array(z.string()).optional(),
  urlBlocklist: z.array(z.string()).optional(),
  maxBodyBytes: z.number().optional()
});

export const GetFiltersInputSchema = z.object({
  targetId: z.string()
});

// Type exports
export type ListTargetsInput = z.infer<typeof ListTargetsInputSchema>;
export type ObserveInput = z.infer<typeof ObserveInputSchema>;
export type StopObserveInput = z.infer<typeof StopObserveInputSchema>;
export type ReadEventsInput = z.infer<typeof ReadEventsInputSchema>;
export type ClearEventsInput = z.infer<typeof ClearEventsInputSchema>;
export type GetResponseBodyInput = z.infer<typeof GetResponseBodyInputSchema>;
export type SetFiltersInput = z.infer<typeof SetFiltersInputSchema>;
export type GetFiltersInput = z.infer<typeof GetFiltersInputSchema>;