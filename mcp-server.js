#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import CDP from 'chrome-remote-interface';
import { z } from 'zod';

// Create MCP server
const server = new McpServer({
  name: "cdp-observer",
  version: "1.0.0"
});

// Store sessions and events
const sessions = new Map();
const eventBuffers = new Map();

// Register cdp_list_targets tool
server.registerTool("cdp_list_targets",
  {
    title: "List CDP Targets",
    description: "List all available Chrome DevTools Protocol targets",
    inputSchema: {
      host: z.string().default('127.0.0.1'),
      port: z.number().default(9222)
    }
  },
  async ({ host, port }) => {
    try {
      const targets = await CDP.List({ host, port });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            targets: targets.map(t => ({
              id: t.id,
              type: t.type,
              title: t.title,
              url: t.url
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'BROWSER_UNREACHABLE',
              message: error.message
            }
          })
        }]
      };
    }
  }
);

// Register cdp_observe tool
server.registerTool("cdp_observe",
  {
    title: "Observe CDP Target",
    description: "Start observing Console and Network events for a target",
    inputSchema: {
      host: z.string().default('127.0.0.1'),
      port: z.number().default(9222),
      targetId: z.string().optional(),
      urlIncludes: z.string().optional()
    }
  },
  async ({ host, port, targetId, urlIncludes }) => {
    // Resolve target if URL pattern is provided
    if (!targetId && urlIncludes) {
      try {
        const targets = await CDP.List({ host, port });
        const target = targets.find(t => t.url && t.url.includes(urlIncludes));
        if (!target) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: {
                  code: 'TARGET_NOT_FOUND',
                  message: `No target found with URL containing: ${urlIncludes}`
                }
              })
            }]
          };
        }
        targetId = target.id;
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: {
                code: 'BROWSER_UNREACHABLE',
                message: error.message
              }
            })
          }]
        };
      }
    }
    
    if (!targetId) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'INVALID_INPUT',
              message: 'Either targetId or urlIncludes must be provided'
            }
          })
        }]
      };
    }
    try {
      // Check if already observing
      if (sessions.has(targetId)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: {
                code: 'ALREADY_OBSERVING',
                message: `Already observing target: ${targetId}`
              }
            })
          }]
        };
      }

      const client = await CDP({
        host,
        port,
        target: targetId
      });
      
      // Enable domains
      await client.Runtime.enable();
      await client.Log.enable();
      await client.Network.enable({});
      
      // Store session
      sessions.set(targetId, client);
      eventBuffers.set(targetId, []);
      
      // Listen to Console events
      client.Runtime.consoleAPICalled((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        
        // Extract text from arguments
        const text = params.args?.map(a => {
          if (a.type === 'string') return a.value;
          if (a.type === 'number') return String(a.value);
          if (a.type === 'boolean') return String(a.value);
          if (a.type === 'undefined') return 'undefined';
          if (a.type === 'object' && a.subtype === 'null') return 'null';
          if (a.description) return a.description;
          return JSON.stringify(a);
        }).join(' ') || '';
        
        // Extract stack trace if available
        let stack = null;
        if (params.stackTrace && params.stackTrace.callFrames) {
          stack = params.stackTrace.callFrames.map(frame => ({
            functionName: frame.functionName || '<anonymous>',
            url: frame.url,
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber
          }));
        }
        
        // Get exception details if this is an error
        let exceptionDetails = null;
        if (params.exceptionDetails) {
          exceptionDetails = {
            text: params.exceptionDetails.text,
            lineNumber: params.exceptionDetails.lineNumber,
            columnNumber: params.exceptionDetails.columnNumber,
            url: params.exceptionDetails.url,
            stackTrace: params.exceptionDetails.stackTrace?.callFrames?.map(frame => ({
              functionName: frame.functionName || '<anonymous>',
              url: frame.url,
              lineNumber: frame.lineNumber,
              columnNumber: frame.columnNumber
            }))
          };
        }
        
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'console',
          type: params.type,
          text,
          stack,
          exceptionDetails,
          url: params.stackTrace?.callFrames?.[0]?.url || null
        });
        if (buffer.length > 10000) buffer.shift();
      });
      
      // Listen to Runtime exceptions
      client.Runtime.exceptionThrown((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        
        let stack = null;
        if (params.exceptionDetails.stackTrace) {
          stack = params.exceptionDetails.stackTrace.callFrames.map(frame => ({
            functionName: frame.functionName || '<anonymous>',
            url: frame.url,
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber
          }));
        }
        
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'console',
          type: 'error',
          text: params.exceptionDetails.text || params.exceptionDetails.exception?.description || 'Uncaught exception',
          stack,
          exceptionDetails: {
            text: params.exceptionDetails.text,
            lineNumber: params.exceptionDetails.lineNumber,
            columnNumber: params.exceptionDetails.columnNumber,
            url: params.exceptionDetails.url
          },
          url: params.exceptionDetails.url
        });
        if (buffer.length > 10000) buffer.shift();
      });

      // Listen to Log events
      client.Log.entryAdded((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'log',
          level: params.entry.level,
          text: params.entry.text || ''
        });
        if (buffer.length > 10000) buffer.shift();
      });
      
      // Listen to Network events
      client.Network.requestWillBeSent((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'request',
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers
        });
        if (buffer.length > 10000) buffer.shift();
      });
      
      client.Network.responseReceived((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'response',
          requestId: params.requestId,
          url: params.response.url,
          status: params.response.status,
          statusText: params.response.statusText,
          mimeType: params.response.mimeType
        });
        if (buffer.length > 10000) buffer.shift();
      });

      client.Network.loadingFinished((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'loadingFinished',
          requestId: params.requestId,
          encodedDataLength: params.encodedDataLength
        });
        if (buffer.length > 10000) buffer.shift();
      });

      client.Network.loadingFailed((params) => {
        const buffer = eventBuffers.get(targetId) || [];
        buffer.push({
          seq: buffer.length,
          ts: Date.now(),
          targetId,
          kind: 'loadingFailed',
          requestId: params.requestId,
          errorText: params.errorText,
          canceled: params.canceled
        });
        if (buffer.length > 10000) buffer.shift();
      });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            targetId,
            attached: true
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'CONNECTION_FAILED',
              message: error.message
            }
          })
        }]
      };
    }
  }
);

// Register cdp_read_events tool
server.registerTool("cdp_read_events",
  {
    title: "Read CDP Events",
    description: "Read and filter events from the buffer. Use 'types' for filtering console types (error/warn/log), 'textIncludes' for text search, 'reverse:true' to get latest events first",
    inputSchema: {
      targetId: z.string().describe("Target tab ID from cdp_observe"),
      offset: z.number().default(0).describe("Skip first N filtered events"),
      limit: z.number().default(200).describe("Maximum events to return"),
      kinds: z.array(z.enum(['console', 'log', 'request', 'response', 'loadingFinished', 'loadingFailed']))
        .optional()
        .describe("Event categories to include"),
      types: z.array(z.string())
        .optional()
        .describe("Console types: error, warn, log, info, debug - use ['error'] for errors only"),
      textIncludes: z.string()
        .optional()
        .describe("Search in event text (case-insensitive) - e.g. 'TypeError' to find TypeErrors"),
      urlIncludes: z.string()
        .optional()
        .describe("Filter by URL/filename - e.g. 'app.js' or '/api/'"),
      reverse: z.boolean()
        .default(false)
        .describe("Set to true to get latest events first (recommended for debugging)")
    }
  },
  async ({ targetId, offset, limit, kinds, types, textIncludes, urlIncludes, reverse }) => {
    const buffer = eventBuffers.get(targetId) || [];
    
    // Apply filters BEFORE slicing for better search
    let filteredEvents = [...buffer];
    
    // Reverse if searching from newest
    if (reverse) {
      filteredEvents = filteredEvents.reverse();
    }
    
    // Filter by kinds if specified
    if (kinds && kinds.length > 0) {
      filteredEvents = filteredEvents.filter(e => kinds.includes(e.kind));
    }
    
    // Filter by types (for console/log events)
    if (types && types.length > 0) {
      filteredEvents = filteredEvents.filter(e => {
        if (e.kind === 'console' || e.kind === 'log') {
          return types.includes(e.type) || (e.level && types.includes(e.level));
        }
        return true;
      });
    }
    
    // Filter by text content
    if (textIncludes) {
      filteredEvents = filteredEvents.filter(e => {
        if (e.text) {
          return e.text.toLowerCase().includes(textIncludes.toLowerCase());
        }
        return false;
      });
    }
    
    // Filter by URL
    if (urlIncludes) {
      filteredEvents = filteredEvents.filter(e => {
        if (e.url) {
          return e.url.includes(urlIncludes);
        }
        return false;
      });
    }
    
    // Now slice the filtered results
    const events = filteredEvents.slice(offset, offset + limit);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          nextOffset: Math.min(offset + limit, filteredEvents.length),
          totalEvents: buffer.length,
          filteredCount: filteredEvents.length,
          events
        }, null, 2)
      }]
    };
  }
);

// Register cdp_reload tool
server.registerTool("cdp_reload",
  {
    title: "Reload Page",
    description: "Reload the page in the observed tab",
    inputSchema: {
      targetId: z.string().describe("Target tab ID to reload"),
      ignoreCache: z.boolean().default(false).describe("Force reload ignoring cache (hard reload)")
    }
  },
  async ({ targetId, ignoreCache }) => {
    const session = sessions.get(targetId);
    if (!session) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'NOT_OBSERVING',
              message: `Not observing target: ${targetId}. Please run cdp_observe first.`
            }
          })
        }]
      };
    }
    
    try {
      // Enable Page domain if not already enabled
      await session.Page.enable();
      
      // Reload the page
      await session.Page.reload({ ignoreCache });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            targetId,
            ignoreCache,
            message: `Page reloaded${ignoreCache ? ' (cache ignored)' : ''}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'RELOAD_FAILED',
              message: error.message
            }
          })
        }]
      };
    }
  }
);

// Register cdp_navigate tool
server.registerTool("cdp_navigate",
  {
    title: "Navigate to URL",
    description: "Navigate the observed tab to a new URL",
    inputSchema: {
      targetId: z.string().describe("Target tab ID"),
      url: z.string().describe("URL to navigate to (must include protocol, e.g., https://)")
    }
  },
  async ({ targetId, url }) => {
    const session = sessions.get(targetId);
    if (!session) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'NOT_OBSERVING',
              message: `Not observing target: ${targetId}. Please run cdp_observe first.`
            }
          })
        }]
      };
    }
    
    try {
      // Enable Page domain if not already enabled
      await session.Page.enable();
      
      // Navigate to the URL
      const result = await session.Page.navigate({ url });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            targetId,
            url,
            frameId: result.frameId,
            loaderId: result.loaderId
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'NAVIGATION_FAILED',
              message: error.message
            }
          })
        }]
      };
    }
  }
);

// Register cdp_execute_script tool
server.registerTool("cdp_execute_script",
  {
    title: "Execute JavaScript",
    description: "Execute JavaScript code in the observed tab",
    inputSchema: {
      targetId: z.string().describe("Target tab ID"),
      expression: z.string().describe("JavaScript expression to execute"),
      awaitPromise: z.boolean().default(false).describe("Wait for promise resolution if the result is a promise")
    }
  },
  async ({ targetId, expression, awaitPromise }) => {
    const session = sessions.get(targetId);
    if (!session) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'NOT_OBSERVING',
              message: `Not observing target: ${targetId}. Please run cdp_observe first.`
            }
          })
        }]
      };
    }
    
    try {
      // Evaluate the expression
      const result = await session.Runtime.evaluate({
        expression,
        awaitPromise,
        returnByValue: true
      });
      
      if (result.exceptionDetails) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: {
                code: 'EXECUTION_ERROR',
                message: result.exceptionDetails.text || 'Script execution failed',
                details: result.exceptionDetails
              }
            }, null, 2)
          }]
        };
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            targetId,
            result: result.result.value,
            type: result.result.type
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'EXECUTION_FAILED',
              message: error.message
            }
          })
        }]
      };
    }
  }
);

// Register cdp_stop_observe tool
server.registerTool("cdp_stop_observe",
  {
    title: "Stop Observing",
    description: "Stop observing a target",
    inputSchema: {
      targetId: z.string(),
      clearBuffer: z.boolean().default(false)
    }
  },
  async ({ targetId, clearBuffer }) => {
    const session = sessions.get(targetId);
    if (!session) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'NOT_OBSERVING',
              message: `Not observing target: ${targetId}`
            }
          })
        }]
      };
    }
    
    // Close CDP connection
    await session.close();
    sessions.delete(targetId);
    
    // Clear buffer if requested
    if (clearBuffer) {
      eventBuffers.delete(targetId);
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          stopped: true,
          bufferCleared: clearBuffer
        })
      }]
    };
  }
);

// Register cdp_clear_events tool
server.registerTool("cdp_clear_events",
  {
    title: "Clear Events",
    description: "Clear the event buffer for a target",
    inputSchema: {
      targetId: z.string()
    }
  },
  async ({ targetId }) => {
    if (!eventBuffers.has(targetId)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'TARGET_NOT_FOUND',
              message: `No buffer found for target: ${targetId}`
            }
          })
        }]
      };
    }
    
    eventBuffers.set(targetId, []);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ cleared: true })
      }]
    };
  }
);

// Register cdp_get_response_body tool
server.registerTool("cdp_get_response_body",
  {
    title: "Get Response Body",
    description: "Get the response body for a network request",
    inputSchema: {
      targetId: z.string(),
      requestId: z.string(),
      base64: z.boolean().default(false)
    }
  },
  async ({ targetId, requestId, base64 }) => {
    const session = sessions.get(targetId);
    if (!session) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'NOT_OBSERVING',
              message: `Not observing target: ${targetId}`
            }
          })
        }]
      };
    }
    
    try {
      const response = await session.Network.getResponseBody({ requestId });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            requestId,
            encoded: response.base64Encoded || base64,
            body: base64 && !response.base64Encoded 
              ? Buffer.from(response.body).toString('base64')
              : response.body
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: {
              code: 'BODY_NOT_AVAILABLE',
              message: error.message
            }
          })
        }]
      };
    }
  }
);

// Start server
async function main() {
  console.error('Starting CDP Observer MCP Server...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CDP Observer MCP Server started successfully');
}

// Handle process termination
process.on('SIGINT', async () => {
  console.error('Shutting down CDP Observer...');
  for (const [, client] of sessions) {
    await client.close().catch(() => {});
  }
  process.exit(0);
});

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});