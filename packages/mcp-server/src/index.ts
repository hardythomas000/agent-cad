#!/usr/bin/env node
/**
 * agent-cad MCP Server
 *
 * Wraps the SDF geometry kernel as 21 callable tools for LLM agents.
 * Runs over stdio transport — plug into Claude Code, Cursor, etc.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new McpServer({
  name: 'agent-cad',
  version: '0.1.0',
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
