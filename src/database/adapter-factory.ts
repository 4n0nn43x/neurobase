/**
 * Database Adapter Factory
 * Creates the appropriate adapter based on engine configuration
 */

import { DatabaseAdapter, DatabaseConfig } from './adapter';
import { PostgresAdapter } from './adapters/postgres';
import { MySQLAdapter } from './adapters/mysql';
import { SQLiteAdapter } from './adapters/sqlite';
import { MongoDBAdapter } from './adapters/mongodb';

export class AdapterFactory {
  static create(config: DatabaseConfig): DatabaseAdapter {
    switch (config.engine) {
      case 'postgresql':
        return new PostgresAdapter(config);

      case 'mysql':
        return new MySQLAdapter(config);

      case 'sqlite':
        return new SQLiteAdapter(config);

      case 'mongodb':
        return new MongoDBAdapter(config);

      default:
        throw new Error(`Unsupported database engine: ${config.engine}`);
    }
  }
}
