/**
 * MCP Server (Phase 3A)
 * Inspired by DBHub (100k+ downloads)
 *
 * Model Context Protocol server allowing Claude Desktop, Cursor, etc.
 * to connect directly to NeuroBase.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NeuroBase } from '../core/neurobase';
import { loadConfig } from '../config';
import { logger } from '../utils/logger';

async function main() {
  const config = loadConfig();
  const neurobase = new NeuroBase(config);
  await neurobase.initialize();

  const server = new McpServer({
    name: 'neurobase',
    version: '3.0.0',
  });

  // Tool: query — NL → SQL → execute
  server.tool(
    'query',
    'Translate a natural language question into SQL and execute it against the database',
    {
      question: z.string().describe('The natural language question about the database'),
      userId: z.string().optional().describe('Optional user ID for personalized context'),
    },
    async ({ question, userId }) => {
      try {
        const result = await neurobase.query({
          text: question,
          userId,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              sql: result.sql,
              rowCount: result.rowCount,
              executionTime: result.executionTime,
              data: result.data.slice(0, 50), // Limit rows
              explanation: result.explanation,
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: schema — return database schema
  server.tool(
    'schema',
    'Get the database schema including tables, columns, and relationships',
    {},
    async () => {
      try {
        const schema = await neurobase.getSchemaIntrospector().getSchemaAsText();
        return {
          content: [{ type: 'text' as const, text: schema }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: explain — dry-run without execution
  server.tool(
    'explain',
    'Translate a natural language question to SQL without executing it',
    {
      question: z.string().describe('The natural language question'),
    },
    async ({ question }) => {
      try {
        const schema = await neurobase.getSchemaIntrospector().getSchema();
        const linguisticAgent = (neurobase as any).linguisticAgent;

        const result = await linguisticAgent.process({
          query: { text: question },
          schema,
          learningHistory: [],
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              sql: result.sql,
              confidence: result.confidence,
              explanation: result.explanation,
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: correct — submit a correction
  server.tool(
    'correct',
    'Submit a SQL correction for learning',
    {
      originalQuery: z.string().describe('The original natural language query'),
      correctSQL: z.string().describe('The corrected SQL'),
      reason: z.string().optional().describe('Reason for correction'),
    },
    async ({ originalQuery, correctSQL, reason }) => {
      try {
        await neurobase.correct(originalQuery, correctSQL, reason);
        return {
          content: [{ type: 'text' as const, text: 'Correction stored successfully.' }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: diagnose — diagnostic tree search
  server.tool(
    'diagnose',
    'Diagnose performance issues with a SQL query using tree-based diagnostic search',
    {
      sql: z.string().describe('The SQL query to diagnose'),
    },
    async ({ sql }) => {
      try {
        if (typeof (neurobase as any).diagnose === 'function') {
          const result = await (neurobase as any).diagnose(sql);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: 'Diagnostic not available.' }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: stats — database statistics
  server.tool(
    'stats',
    'Get database statistics and NeuroBase system info',
    {},
    async () => {
      try {
        const stats = await neurobase.getStats();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(stats, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Resource: schema://tables — list all tables
  server.resource(
    'schema://tables',
    'schema://tables',
    async (uri) => {
      const schema = await neurobase.getSchemaIntrospector().getSchema();
      const tableList = schema.tables.map(t => ({
        name: t.name,
        columns: t.columns.length,
        rowCount: t.rowCount,
      }));

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(tableList, null, 2),
        }],
      };
    }
  );

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('NeuroBase MCP Server started (stdio transport)');
}

main().catch((error) => {
  console.error('MCP Server failed to start:', error);
  process.exit(1);
});
