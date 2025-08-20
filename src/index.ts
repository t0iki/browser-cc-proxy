#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StdioTransport } from '@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import pino from 'pino';
import { loadConfig } from './config.js';
import { SessionManager } from './store/sessions.js';
import { registerTools } from './mcp/tools.js';
import { registerResources } from './mcp/resources.js';

// Initialize logger
const config = loadConfig();
const logger = pino({ level: config.logLevel });

// Create MCP server
const server = new Server({
  name: 'cdp-observer',
  version: '1.0.0',
  capabilities: {
    tools: true,
    resources: {
      list: false,
      read: true,
      subscribe: true
    }
  }
});

// Initialize session manager
const sessions = new SessionManager(config);
sessions.setServer(server);

// Register tools and resources
registerTools(server, sessions, config);
registerResources(server, sessions);

// Set up garbage collection
setInterval(() => {
  sessions.gc();
}, 60000); // Run every minute

// Handle server errors

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('Shutting down CDP Observer...');
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down CDP Observer...');
  await server.close();
  process.exit(0);
});

// Start server
async function main() {
  logger.info('Starting CDP Observer MCP Server...');
  logger.info({ config }, 'Configuration loaded');
  
  const transport = new StdioTransport();
  await server.connect(transport);
  
  logger.info('CDP Observer MCP Server started successfully');
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
});