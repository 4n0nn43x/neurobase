/**
 * Database Fork Manager
 * Manages Tiger Data database forks for safe testing and experimentation
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface ForkOptions {
  name?: string;
  strategy: 'now' | 'last-snapshot' | 'to-timestamp';
  timestamp?: string; // RFC3339 format for to-timestamp strategy
  cpu?: string;
  memory?: string;
  waitForCompletion?: boolean;
  setAsDefault?: boolean;
}

export interface ForkInfo {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  parentServiceId?: string;
}

export class DatabaseForkManager {
  private currentServiceId: string;

  constructor(serviceId?: string) {
    // Get service ID from environment or parameter
    this.currentServiceId = serviceId || this.extractServiceIdFromConnectionString();
  }

  /**
   * Extract service ID from DATABASE_URL connection string
   */
  private extractServiceIdFromConnectionString(): string {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL not found in environment');
    }

    // Extract host from connection string (format: hostname.tsdb.cloud.timescale.com)
    const hostMatch = dbUrl.match(/@([^:]+):/);
    if (hostMatch && hostMatch[1]) {
      const host = hostMatch[1];
      // Extract service ID from host (e.g., yz6ydsia5c from yz6ydsia5c.wjxdfgi7rr.tsdb.cloud.timescale.com)
      const serviceIdMatch = host.match(/^([a-z0-9]+)\./);
      if (serviceIdMatch) {
        // Return service ID without prefix (Tiger CLI uses plain service ID)
        return serviceIdMatch[1];
      }
    }

    throw new Error('Could not extract service ID from DATABASE_URL');
  }

  /**
   * Create a new database fork
   */
  async createFork(options: ForkOptions): Promise<ForkInfo> {
    logger.info({ serviceId: this.currentServiceId, options }, 'Creating database fork');

    const args: string[] = ['service', 'fork', this.currentServiceId];

    // Add strategy flag
    switch (options.strategy) {
      case 'now':
        args.push('--now');
        break;
      case 'last-snapshot':
        args.push('--last-snapshot');
        break;
      case 'to-timestamp':
        if (!options.timestamp) {
          throw new Error('timestamp is required for to-timestamp strategy');
        }
        args.push('--to-timestamp', options.timestamp);
        break;
    }

    // Add optional flags
    if (options.name) {
      args.push('--name', options.name);
    }
    if (options.cpu) {
      args.push('--cpu', options.cpu);
    }
    if (options.memory) {
      args.push('--memory', options.memory);
    }
    if (options.waitForCompletion === false) {
      args.push('--no-wait');
    }
    if (options.setAsDefault === false) {
      args.push('--no-set-default');
    }

    // Output as JSON for parsing
    args.push('--output', 'json');

    const command = `tiger ${args.join(' ')}`;

    try {
      logger.debug({ command }, 'Executing tiger fork command');
      const { stdout, stderr } = await execAsync(command);

      // Tiger CLI outputs human-readable messages to stderr and JSON to stdout
      // Extract service ID from stderr message: "📋 New Service ID: sly0nax5ba"
      let newServiceId: string | undefined;
      if (stderr) {
        const serviceIdMatch = stderr.match(/New Service ID:\s*([a-z0-9]+)/i);
        if (serviceIdMatch) {
          newServiceId = serviceIdMatch[1];
        }
      }

      // Parse JSON output
      let result: any = {};
      try {
        result = JSON.parse(stdout);
      } catch (e) {
        // If JSON parsing fails, create a basic result object
        result = {};
      }

      const forkId = newServiceId || result.service_id || result.id;
      const forkName = result.name || `${this.currentServiceId}-fork`;

      logger.info({ forkId, forkName }, 'Database fork created successfully');

      return {
        id: forkId || 'unknown',
        name: forkName,
        status: result.status || 'READY',
        createdAt: result.created || result.created_at || new Date().toISOString(),
        parentServiceId: this.currentServiceId,
      };
    } catch (error) {
      logger.error({ error, command }, 'Failed to create database fork');
      throw new Error(`Failed to create database fork: ${error}`);
    }
  }

  /**
   * List all database services (including forks)
   */
  async listServices(): Promise<ForkInfo[]> {
    logger.debug('Listing database services');

    const command = 'tiger service list --output json';

    try {
      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        logger.warn({ stderr }, 'Tiger list command stderr');
      }

      // Parse JSON output
      const services = JSON.parse(stdout);

      return services.map((service: any) => ({
        id: service.service_id || service.id,
        name: service.name,
        status: service.status,
        createdAt: service.created || service.created_at,
        parentServiceId: service.parent_service_id,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to list database services');
      throw new Error(`Failed to list database services: ${error}`);
    }
  }

  /**
   * Delete a database fork
   */
  async deleteFork(forkId: string): Promise<void> {
    logger.info({ forkId }, 'Deleting database fork');

    const command = `tiger service delete ${forkId} --confirm`;

    try {
      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        logger.warn({ stderr }, 'Tiger delete command stderr');
      }

      logger.info({ forkId, output: stdout }, 'Database fork deleted successfully');
    } catch (error) {
      logger.error({ error, forkId }, 'Failed to delete database fork');
      throw new Error(`Failed to delete database fork: ${error}`);
    }
  }

  /**
   * Get connection string for a fork
   */
  async getForkConnectionString(forkId: string): Promise<string> {
    logger.debug({ forkId }, 'Getting fork connection string');

    const command = `tiger service connection-string ${forkId} --output json`;

    try {
      const { stdout, stderr } = await execAsync(command);

      if (stderr) {
        logger.warn({ stderr }, 'Tiger connection-string command stderr');
      }

      const result = JSON.parse(stdout);
      return result.connection_string || result.connectionString || stdout.trim();
    } catch (error) {
      logger.error({ error, forkId }, 'Failed to get fork connection string');
      throw new Error(`Failed to get fork connection string: ${error}`);
    }
  }

  /**
   * Get current service ID
   */
  getCurrentServiceId(): string {
    return this.currentServiceId;
  }
}
