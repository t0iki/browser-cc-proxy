import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/resources/index.js';
import { SessionManager } from '../store/sessions.js';

export function registerResources(server: Server, sessions: SessionManager) {
  // Register resource template for cdp://events/{targetId}
  server.registerResource(
    'cdp-events',
    new ResourceTemplate('cdp://events/{targetId}', {
      list: undefined
    }),
    {
      name: 'CDP Events',
      description: 'Console and Network events from CDP target as JSON'
    },
    async (uri, { targetId }) => {
      try {
        const session = sessions.getSession(targetId as string);
        
        if (!session) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({
                error: {
                  code: 'SESSION_NOT_FOUND',
                  message: `No session found for target: ${targetId}`
                }
              })
            }]
          };
        }
        
        // Get last 200 events by default
        const { events, nextOffset } = session.buffer.getTail(200);
        
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              nextOffset,
              events
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
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