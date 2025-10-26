/**
 * Tiger MCP Client
 * Connects to Tiger Data's MCP server for production-level Postgres expertise
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * Tiger MCP Client for accessing Tiger Data's production-tested Postgres expertise
 */
export class TigerMCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;

  constructor() {
    logger.debug('TigerMCPClient initialized');
  }

  /**
   * Connect to Tiger MCP server
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.debug('Already connected to Tiger MCP server');
      return;
    }

    try {
      logger.info('Connecting to Tiger MCP server...');

      // Create transport (it will spawn the process automatically)
      this.transport = new StdioClientTransport({
        command: 'tiger',
        args: ['mcp', 'start'],
      });

      // Create client
      this.client = new Client(
        {
          name: 'neurobase',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            prompts: {},
          },
        }
      );

      // Connect via transport
      await this.client.connect(this.transport);

      this.isConnected = true;
      logger.info('Successfully connected to Tiger MCP server');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to Tiger MCP server');
      throw new Error(`Failed to connect to Tiger MCP server: ${error}`);
    }
  }

  /**
   * Disconnect from Tiger MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      logger.info('Disconnecting from Tiger MCP server...');

      if (this.client) {
        await this.client.close();
        this.client = null;
      }

      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }

      this.isConnected = false;

      logger.info('Disconnected from Tiger MCP server');
    } catch (error) {
      logger.error({ error }, 'Error disconnecting from Tiger MCP server');
    }
  }

  /**
   * Get list of available tools from Tiger MCP server
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.isConnected || !this.client) {
      throw new Error('Not connected to Tiger MCP server');
    }

    try {
      const response = await this.client.listTools();

      logger.debug({ toolsCount: response.tools.length }, 'Listed MCP tools');

      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to list MCP tools');
      throw new Error(`Failed to list MCP tools: ${error}`);
    }
  }

  /**
   * Get list of available prompts from Tiger MCP server
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    if (!this.isConnected || !this.client) {
      throw new Error('Not connected to Tiger MCP server');
    }

    try {
      const response = await this.client.listPrompts();

      logger.debug({ promptsCount: response.prompts.length }, 'Listed MCP prompts');

      return response.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description || '',
        arguments: prompt.arguments,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to list MCP prompts');
      throw new Error(`Failed to list MCP prompts: ${error}`);
    }
  }

  /**
   * Call a tool from Tiger MCP server
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    if (!this.isConnected || !this.client) {
      throw new Error('Not connected to Tiger MCP server');
    }

    try {
      logger.debug({ toolName, args }, 'Calling MCP tool');

      const response = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      logger.debug({ toolName, result: response }, 'MCP tool call successful');

      return response;
    } catch (error) {
      logger.error({ error, toolName }, 'Failed to call MCP tool');
      throw new Error(`Failed to call MCP tool ${toolName}: ${error}`);
    }
  }

  /**
   * Get a prompt from Tiger MCP server
   */
  async getPrompt(promptName: string, args?: Record<string, string>): Promise<string> {
    if (!this.isConnected || !this.client) {
      throw new Error('Not connected to Tiger MCP server');
    }

    try {
      logger.debug({ promptName, args }, 'Getting MCP prompt');

      const response = await this.client.getPrompt({
        name: promptName,
        arguments: args,
      });

      logger.debug({ promptName }, 'MCP prompt retrieved');

      // Extract messages and combine into a single prompt
      const promptText = response.messages
        .map((msg) => {
          if (typeof msg.content === 'string') {
            return msg.content;
          } else if (msg.content && typeof msg.content === 'object' && 'text' in msg.content) {
            return msg.content.text;
          }
          return '';
        })
        .join('\n\n');

      return promptText;
    } catch (error) {
      logger.error({ error, promptName }, 'Failed to get MCP prompt');
      throw new Error(`Failed to get MCP prompt ${promptName}: ${error}`);
    }
  }

  /**
   * Search PostgreSQL documentation using Tiger MCP
   */
  async searchPostgresDocs(query: string): Promise<string> {
    const result = await this.callTool('semantic_search_postgres_docs', { query });
    return this.extractToolContent(result);
  }

  /**
   * Search Tiger/TimescaleDB documentation using Tiger MCP
   */
  async searchTigerDocs(query: string): Promise<string> {
    const result = await this.callTool('semantic_search_tiger_docs', { query });
    return this.extractToolContent(result);
  }

  /**
   * Get a guide from Tiger MCP
   */
  async getGuide(topic: string): Promise<string> {
    const result = await this.callTool('get_guide', { topic });
    return this.extractToolContent(result);
  }

  /**
   * Extract text content from MCP tool result
   */
  private extractToolContent(result: any): string {
    if (!result || !result.content) {
      return '';
    }

    if (Array.isArray(result.content)) {
      return result.content
        .map((item: any) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item.type === 'text' && item.text) {
            return item.text;
          }
          return '';
        })
        .filter((text: string) => text)
        .join('\n\n');
    }

    if (typeof result.content === 'string') {
      return result.content;
    }

    return '';
  }

  /**
   * Check if connected
   */
  isActive(): boolean {
    return this.isConnected;
  }
}
