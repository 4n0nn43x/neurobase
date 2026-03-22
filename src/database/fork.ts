/**
 * Database Fork Manager
 * Manages database forks via the DatabaseAdapter abstraction
 */

import { DatabaseAdapter, ForkInfo, ForkOptions } from './adapter';
import { logger } from '../utils/logger';

export { ForkInfo, ForkOptions } from './adapter';

export class DatabaseForkManager {
  private adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }

  /**
   * Create a new database fork
   */
  async createFork(options: ForkOptions): Promise<ForkInfo> {
    logger.info({ options }, 'Creating database fork');
    return this.adapter.createFork(options);
  }

  /**
   * List all database forks
   */
  async listForks(): Promise<ForkInfo[]> {
    logger.debug('Listing database forks');
    return this.adapter.listForks();
  }

  /**
   * Delete a database fork
   */
  async deleteFork(forkId: string): Promise<void> {
    logger.info({ forkId }, 'Deleting database fork');
    return this.adapter.deleteFork(forkId);
  }
}
