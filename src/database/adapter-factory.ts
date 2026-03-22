/**
 * Database Adapter Factory
 * Creates the appropriate adapter based on engine configuration
 */

import { DatabaseAdapter, DatabaseConfig } from './adapter';
import { PostgresAdapter } from './adapters/postgres';

export class AdapterFactory {
  static create(config: DatabaseConfig): DatabaseAdapter {
    switch (config.engine) {
      case 'postgresql':
        return new PostgresAdapter(config);

      case 'mysql':
        throw new Error('MySQL adapter not yet implemented. Install mysql2 and add MySQLAdapter.');

      case 'sqlite':
        throw new Error('SQLite adapter not yet implemented. Install better-sqlite3 and add SQLiteAdapter.');

      case 'mongodb':
        throw new Error('MongoDB adapter not yet implemented. Install mongodb and add MongoDBAdapter.');

      default:
        throw new Error(`Unsupported database engine: ${config.engine}`);
    }
  }
}
