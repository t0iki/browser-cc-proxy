import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { zodToJsonSchema } from '../utils/zod-to-json-schema.js';
import {
  ListTargetsInputSchema,
  ObserveInputSchema,
  StopObserveInputSchema,
  ReadEventsInputSchema,
  ClearEventsInputSchema,
  GetResponseBodyInputSchema,
  SetFiltersInputSchema,
  GetFiltersInputSchema,
  type ListTargetsInput,
  type ObserveInput,
  type StopObserveInput,
  type ReadEventsInput,
  type ClearEventsInput,
  type GetResponseBodyInput,
  type SetFiltersInput,
  type GetFiltersInput
} from './schemas.js';
import { SessionManager } from '../store/sessions.js';
import { listTargets } from '../cdp/connect.js';
import { getResponseBody } from '../cdp/connect.js';
import type { Config } from '../config.js';

export function registerTools(server: Server, sessions: SessionManager, config: Config) {
  // cdp_list_targets
  server.registerTool(
    'cdp_list_targets',
    {
      name: 'cdp_list_targets',
      description: 'List all available CDP targets (browser tabs)',
      inputSchema: zodToJsonSchema(ListTargetsInputSchema) as any
    },
    async (input) => {
      try {
        const params = ListTargetsInputSchema.parse(input);
        const targets = await listTargets(params.host, params.port, config);
        
        let filtered = targets;
        if (params.filterUrlIncludes) {
          filtered = filtered.filter(t => t.url.includes(params.filterUrlIncludes!));
        }
        if (params.types && params.types.length > 0) {
          filtered = filtered.filter(t => params.types!.includes(t.type));
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ targets: filtered }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'BROWSER_UNREACHABLE',
                message: String(error)
              }
            })
          }]
        };
      }
    }
  );

  // cdp_observe
  server.registerTool(
    'cdp_observe',
    {
      name: 'cdp_observe',
      description: 'Start observing Console and Network events for a target',
      inputSchema: zodToJsonSchema(ObserveInputSchema) as any
    },
    async (input) => {
      try {
        const params = ObserveInputSchema.parse(input);
        const session = await sessions.observe(params);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              targetId: session.targetId,
              resourceUri: `cdp://events/${session.targetId}`,
              attached: true
            }, null, 2)
          }]
        };
      } catch (error) {
        const message = String(error);
        let code = 'INTERNAL_ERROR';
        if (message.includes('Already observing')) {
          code = 'ALREADY_OBSERVING';
        } else if (message.includes('No target found')) {
          code = 'TARGET_NOT_FOUND';
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: { code, message }
            })
          }]
        };
      }
    }
  );

  // cdp_stop_observe
  server.registerTool(
    'cdp_stop_observe',
    {
      name: 'cdp_stop_observe',
      description: 'Stop observing a target',
      inputSchema: zodToJsonSchema(StopObserveInputSchema) as any
    },
    async (input) => {
      try {
        const params = StopObserveInputSchema.parse(input);
        await sessions.stopObserve(params.targetId, params.dropBuffer);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ stopped: true })
          }]
        };
      } catch (error) {
        const message = String(error);
        const code = message.includes('Not observing') ? 'NOT_OBSERVING' : 'INTERNAL_ERROR';
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: { code, message }
            })
          }]
        };
      }
    }
  );

  // cdp_read_events
  server.registerTool(
    'cdp_read_events',
    {
      name: 'cdp_read_events',
      description: 'Read events from the buffer',
      inputSchema: zodToJsonSchema(ReadEventsInputSchema) as any
    },
    async (input) => {
      try {
        const params = ReadEventsInputSchema.parse(input);
        const session = sessions.getSession(params.targetId);
        
        if (!session) {
          throw new Error(`No session found for target: ${params.targetId}`);
        }
        
        const { events, nextOffset } = session.buffer.sliceByOffset(
          params.offset,
          params.limit
        );
        
        // Apply filters
        let filtered = events;
        if (params.kinds && params.kinds.length > 0) {
          filtered = filtered.filter(e => params.kinds!.includes(e.kind));
        }
        if (params.urlIncludes) {
          filtered = filtered.filter(e => {
            const url = (e as any).url;
            return url && url.includes(params.urlIncludes!);
          });
        }
        if (params.method) {
          filtered = filtered.filter(e => {
            const method = (e as any).method;
            return method && method === params.method;
          });
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ nextOffset, events: filtered }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: String(error)
              }
            })
          }]
        };
      }
    }
  );

  // cdp_clear_events
  server.registerTool(
    'cdp_clear_events',
    {
      name: 'cdp_clear_events',
      description: 'Clear the event buffer for a target',
      inputSchema: zodToJsonSchema(ClearEventsInputSchema) as any
    },
    async (input) => {
      try {
        const params = ClearEventsInputSchema.parse(input);
        sessions.clearEvents(params.targetId);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ cleared: true })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: String(error)
              }
            })
          }]
        };
      }
    }
  );

  // cdp_get_response_body
  server.registerTool(
    'cdp_get_response_body',
    {
      name: 'cdp_get_response_body',
      description: 'Get the response body for a network request',
      inputSchema: zodToJsonSchema(GetResponseBodyInputSchema) as any
    },
    async (input) => {
      try {
        const params = GetResponseBodyInputSchema.parse(input);
        const session = sessions.getSession(params.targetId);
        
        if (!session || !session.client) {
          throw new Error(`No active session for target: ${params.targetId}`);
        }
        
        const { body, base64Encoded } = await getResponseBody(
          session.client,
          params.requestId
        );
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              requestId: params.requestId,
              mimeType: 'unknown', // Could be enhanced
              encoded: base64Encoded || params.base64,
              body: params.base64 && !base64Encoded 
                ? Buffer.from(body).toString('base64')
                : body
            }, null, 2)
          }]
        };
      } catch (error) {
        const message = String(error);
        const code = message.includes('Failed to get response body') 
          ? 'BODY_NOT_AVAILABLE' 
          : 'INTERNAL_ERROR';
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: { code, message }
            })
          }]
        };
      }
    }
  );

  // cdp_set_filters
  server.registerTool(
    'cdp_set_filters',
    {
      name: 'cdp_set_filters',
      description: 'Set filters for event observation',
      inputSchema: zodToJsonSchema(SetFiltersInputSchema) as any
    },
    async (input) => {
      try {
        const params = SetFiltersInputSchema.parse(input);
        sessions.setFilters(params.targetId, {
          kinds: params.kinds,
          urlAllowlist: params.urlAllowlist,
          urlBlocklist: params.urlBlocklist,
          maxBodyBytes: params.maxBodyBytes
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ updated: true })
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: String(error)
              }
            })
          }]
        };
      }
    }
  );

  // cdp_get_filters
  server.registerTool(
    'cdp_get_filters',
    {
      name: 'cdp_get_filters',
      description: 'Get current filters for a target',
      inputSchema: zodToJsonSchema(GetFiltersInputSchema) as any
    },
    async (input) => {
      try {
        const params = GetFiltersInputSchema.parse(input);
        const filters = sessions.getFilters(params.targetId);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              filters: {
                kinds: filters.kinds || [],
                urlAllowlist: filters.urlAllowlist || [],
                urlBlocklist: filters.urlBlocklist || [],
                maxBodyBytes: filters.maxBodyBytes || 64000
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: String(error)
              }
            })
          }]
        };
      }
    }
  );
}