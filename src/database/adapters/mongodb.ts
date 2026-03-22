/**
 * MongoDB Database Adapter
 * Implements DatabaseAdapter for MongoDB databases
 * Translates the SQL-oriented interface to MongoDB operations
 */

import {
  DatabaseAdapter,
  DatabaseConfig,
  DBQueryResult,
  QueryOptions,
  TransactionHandle,
  ForkInfo,
  ForkOptions,
  TableInfo,
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  ViewInfo,
  FunctionInfo,
  DatabaseStats,
  DialectHints,
} from '../adapter';
import { logger } from '../../utils/logger';

let mongodb: any;

class MongoTransaction implements TransactionHandle {
  private session: any;
  private db: any;
  private finished = false;

  constructor(session: any, db: any) {
    this.session = session;
    this.db = db;
  }

  async query<T = any>(sql: string, _params?: any[]): Promise<DBQueryResult<T>> {
    if (this.finished) throw new Error('Transaction already finished');
    // In MongoDB context, "sql" is actually a JSON command string
    const command = JSON.parse(sql);
    const collection = this.db.collection(command.collection);
    const rows = await collection.find(command.filter || {}, { session: this.session }).toArray();
    return { rows, rowCount: rows.length };
  }

  async commit(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    await this.session.commitTransaction();
    this.session.endSession();
    this.finished = true;
  }

  async rollback(): Promise<void> {
    if (this.finished) throw new Error('Transaction already finished');
    await this.session.abortTransaction();
    this.session.endSession();
    this.finished = true;
  }
}

export class MongoDBAdapter implements DatabaseAdapter {
  private client: any = null;
  private db: any = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      mongodb = require('mongodb');
    } catch {
      throw new Error('mongodb package is not installed. Run: npm install mongodb');
    }

    const { MongoClient } = mongodb;
    this.client = new MongoClient(this.config.connectionString, {
      maxPoolSize: this.config.pool?.max ?? 20,
      tls: this.config.ssl?.enabled || false,
    });

    await this.client.connect();

    // Extract database name from connection string
    const url = new URL(this.config.connectionString);
    const dbName = url.pathname.replace('/', '') || 'neurobase';
    this.db = this.client.db(dbName);

    logger.debug({ database: dbName }, 'MongoDB connected');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  private getDb(): any {
    if (!this.db) throw new Error('MongoDBAdapter not connected');
    return this.db;
  }

  /**
   * For MongoDB, the "sql" parameter is expected to be a JSON string
   * representing a MongoDB operation (aggregation pipeline, find, etc.)
   */
  async query<T = any>(sql: string, _params?: any[], _options?: QueryOptions): Promise<DBQueryResult<T>> {
    const db = this.getDb();
    const startTime = Date.now();

    try {
      const command = JSON.parse(sql);
      const collection = db.collection(command.collection);

      let rows: any[];

      if (command.aggregate) {
        rows = await collection.aggregate(command.aggregate).toArray();
      } else if (command.find) {
        let cursor = collection.find(command.find.filter || {});
        if (command.find.projection) cursor = cursor.project(command.find.projection);
        if (command.find.sort) cursor = cursor.sort(command.find.sort);
        if (command.find.limit) cursor = cursor.limit(command.find.limit);
        if (command.find.skip) cursor = cursor.skip(command.find.skip);
        rows = await cursor.toArray();
      } else if (command.insertOne) {
        const result = await collection.insertOne(command.insertOne);
        rows = [{ insertedId: result.insertedId }];
      } else if (command.insertMany) {
        const result = await collection.insertMany(command.insertMany);
        rows = [{ insertedCount: result.insertedCount }];
      } else if (command.updateMany) {
        const result = await collection.updateMany(command.updateMany.filter, command.updateMany.update);
        rows = [{ modifiedCount: result.modifiedCount }];
      } else if (command.deleteMany) {
        const result = await collection.deleteMany(command.deleteMany.filter || {});
        rows = [{ deletedCount: result.deletedCount }];
      } else {
        // Default: treat as find on collection
        rows = await collection.find({}).limit(100).toArray();
      }

      logger.debug({ collection: command.collection, duration: Date.now() - startTime }, 'MongoDB query');
      return { rows, rowCount: rows.length };
    } catch (error) {
      // If it's not JSON, it might be a raw command - try to handle gracefully
      if (sql.startsWith('{')) {
        throw error;
      }
      logger.warn({ sql: sql.substring(0, 100) }, 'MongoDB adapter received non-JSON query');
      return { rows: [], rowCount: 0 };
    }
  }

  async execute(sql: string, params?: any[], options?: QueryOptions): Promise<{ rowCount: number }> {
    const result = await this.query(sql, params, options);
    return { rowCount: result.rowCount };
  }

  async beginTransaction(): Promise<TransactionHandle> {
    const session = this.client.startSession();
    session.startTransaction();
    return new MongoTransaction(session, this.getDb());
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getDb().admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  async getTables(): Promise<TableInfo[]> {
    const db = this.getDb();
    const collections = await db.listCollections().toArray();
    return collections
      .filter((c: any) => c.type === 'collection')
      .map((c: any) => ({ name: c.name, schema: 'default' }));
  }

  /**
   * Infer schema by sampling documents
   */
  async getColumns(_schema: string, tableName: string): Promise<ColumnInfo[]> {
    const db = this.getDb();
    const collection = db.collection(tableName);
    const sample = await collection.find({}).limit(100).toArray();

    if (sample.length === 0) return [];

    // Infer types from sample documents
    const fieldTypes = new Map<string, Set<string>>();

    for (const doc of sample) {
      this.extractFields(doc, '', fieldTypes);
    }

    return Array.from(fieldTypes.entries()).map(([name, types]) => ({
      name,
      type: Array.from(types).join(' | '),
      nullable: true,
    }));
  }

  private extractFields(obj: any, prefix: string, fieldTypes: Map<string, Set<string>>): void {
    for (const [key, value] of Object.entries(obj)) {
      const fieldName = prefix ? `${prefix}.${key}` : key;
      const type = this.getMongoType(value);

      if (!fieldTypes.has(fieldName)) {
        fieldTypes.set(fieldName, new Set());
      }
      fieldTypes.get(fieldName)!.add(type);
    }
  }

  private getMongoType(value: any): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    if (typeof value === 'object' && value._bsontype === 'ObjectId') return 'ObjectId';
    return typeof value;
  }

  async getPrimaryKeys(_schema: string, _tableName: string): Promise<string[]> {
    return ['_id']; // MongoDB always has _id as primary key
  }

  async getForeignKeys(_schema: string, _tableName: string): Promise<ForeignKeyInfo[]> {
    return []; // MongoDB doesn't have foreign keys
  }

  async getIndexes(_schema: string, tableName: string): Promise<IndexInfo[]> {
    const db = this.getDb();
    const collection = db.collection(tableName);
    const indexes = await collection.indexes();

    return indexes.map((idx: any) => ({
      name: idx.name,
      columns: Object.keys(idx.key),
      unique: idx.unique || false,
      type: Object.values(idx.key).includes('text') ? 'text' : 'btree',
    }));
  }

  async getViews(): Promise<ViewInfo[]> {
    const db = this.getDb();
    const collections = await db.listCollections().toArray();
    return collections
      .filter((c: any) => c.type === 'view')
      .map((c: any) => ({
        name: c.name,
        schema: 'default',
        definition: JSON.stringify(c.options?.viewOn || ''),
      }));
  }

  async getFunctions(): Promise<FunctionInfo[]> {
    return [];
  }

  async getRowCount(_schema: string, tableName: string): Promise<number> {
    try {
      const db = this.getDb();
      return await db.collection(tableName).estimatedDocumentCount();
    } catch {
      return 0;
    }
  }

  async explain(sql: string, _params?: any[]): Promise<any> {
    try {
      const command = JSON.parse(sql);
      const db = this.getDb();
      const collection = db.collection(command.collection);

      if (command.find) {
        return await collection.find(command.find.filter || {}).explain();
      }
      if (command.aggregate) {
        return await collection.aggregate(command.aggregate).explain();
      }
      return {};
    } catch {
      return {};
    }
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    const db = this.getDb();
    const stats = await db.stats();
    const collections = await db.listCollections().toArray();

    return {
      size: `${(stats.dataSize / (1024 * 1024)).toFixed(2)} MB`,
      tables: collections.length,
      connections: 1,
    };
  }

  async createFork(options: ForkOptions): Promise<ForkInfo> {
    const forkId = `fork-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    logger.info({ forkId }, 'MongoDB fork via mongodump not yet fully implemented');
    return { id: forkId, name: options.name || forkId, status: 'pending', createdAt: new Date().toISOString() };
  }

  async deleteFork(_forkId: string): Promise<void> {
    logger.warn('MongoDB fork deletion not yet implemented');
  }

  async listForks(): Promise<ForkInfo[]> {
    return [];
  }

  getDialectName(): string {
    return 'MongoDB';
  }

  getDialectHints(): DialectHints {
    return {
      parameterStyle: 'JSON fields',
      supportsILIKE: false,
      supportsCTEs: false,
      supportsWindowFunctions: true,
      supportsJSONB: true,
      supportsReturning: false,
      identifierQuote: '',
      tips: [
        'Generate MongoDB aggregation pipelines, NOT SQL',
        'Use JSON format: {"collection": "name", "aggregate": [...]}',
        'Or find format: {"collection": "name", "find": {"filter": {...}}}',
        '$match, $group, $sort, $project, $limit, $skip for aggregations',
        '$lookup for joins between collections',
        'Text search with $text operator (requires text index)',
        'Regular expressions with $regex',
        'Array operations: $elemMatch, $in, $nin, $all',
      ],
    };
  }
}
