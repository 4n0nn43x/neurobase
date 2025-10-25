/**
 * Schema introspection for PostgreSQL databases
 */

import { DatabaseConnection } from './connection';
import {
  DatabaseSchema,
  TableSchema,
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  ViewSchema,
  FunctionSchema,
} from '../types';
import { logger } from '../utils/logger';

export class SchemaIntrospector {
  private db: DatabaseConnection;
  private cache: DatabaseSchema | null = null;
  private cacheExpiry: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /**
   * Get the complete database schema
   */
  async getSchema(forceRefresh: boolean = false): Promise<DatabaseSchema> {
    const now = Date.now();

    if (!forceRefresh && this.cache && now < this.cacheExpiry) {
      logger.debug('Using cached schema');
      return this.cache;
    }

    logger.info('Introspecting database schema');

    const [tables, views, functions] = await Promise.all([
      this.getTables(),
      this.getViews(),
      this.getFunctions(),
    ]);

    this.cache = { tables, views, functions };
    this.cacheExpiry = now + this.cacheTTL;

    return this.cache;
  }

  /**
   * Get all tables with their columns, indexes, and foreign keys
   */
  private async getTables(): Promise<TableSchema[]> {
    const tablesResult = await this.db.query<{
      table_schema: string;
      table_name: string;
    }>(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables: TableSchema[] = [];

    for (const row of tablesResult.rows) {
      const [columns, primaryKeys, foreignKeys, indexes, rowCount] =
        await Promise.all([
          this.getColumns(row.table_schema, row.table_name),
          this.getPrimaryKeys(row.table_schema, row.table_name),
          this.getForeignKeys(row.table_schema, row.table_name),
          this.getIndexes(row.table_schema, row.table_name),
          this.getRowCount(row.table_schema, row.table_name),
        ]);

      tables.push({
        name: row.table_name,
        schema: row.table_schema,
        columns,
        primaryKeys,
        foreignKeys,
        indexes,
        rowCount,
      });
    }

    return tables;
  }

  /**
   * Get columns for a table
   */
  private async getColumns(
    schema: string,
    tableName: string
  ): Promise<ColumnSchema[]> {
    const result = await this.db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `,
      [schema, tableName]
    );

    return result.rows.map((row) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      default: row.column_default,
    }));
  }

  /**
   * Get primary keys for a table
   */
  private async getPrimaryKeys(
    schema: string,
    tableName: string
  ): Promise<string[]> {
    const result = await this.db.query<{ column_name: string }>(
      `
      SELECT a.attname as column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ($1 || '.' || $2)::regclass
        AND i.indisprimary
    `,
      [schema, tableName]
    );

    return result.rows.map((row) => row.column_name);
  }

  /**
   * Get foreign keys for a table
   */
  private async getForeignKeys(
    schema: string,
    tableName: string
  ): Promise<ForeignKeySchema[]> {
    const result = await this.db.query<{
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    `,
      [schema, tableName]
    );

    return result.rows.map((row) => ({
      column: row.column_name,
      referencedTable: row.foreign_table_name,
      referencedColumn: row.foreign_column_name,
    }));
  }

  /**
   * Get indexes for a table
   */
  private async getIndexes(
    schema: string,
    tableName: string
  ): Promise<IndexSchema[]> {
    const result = await this.db.query<{
      index_name: string;
      column_names: string[];
      is_unique: boolean;
      index_type: string;
    }>(
      `
      SELECT
        i.relname AS index_name,
        ARRAY_AGG(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS column_names,
        ix.indisunique AS is_unique,
        am.amname AS index_type
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1
        AND t.relname = $2
      GROUP BY i.relname, ix.indisunique, am.amname
    `,
      [schema, tableName]
    );

    return result.rows.map((row) => ({
      name: row.index_name,
      columns: row.column_names,
      unique: row.is_unique,
      type: row.index_type,
    }));
  }

  /**
   * Get row count for a table
   */
  private async getRowCount(
    schema: string,
    tableName: string
  ): Promise<number> {
    try {
      const result = await this.db.query<{ count: string }>(
        `SELECT reltuples::bigint AS count FROM pg_class WHERE oid = ($1 || '.' || $2)::regclass`,
        [schema, tableName]
      );
      return parseInt(result.rows[0]?.count || '0');
    } catch {
      return 0;
    }
  }

  /**
   * Get all views
   */
  private async getViews(): Promise<ViewSchema[]> {
    const result = await this.db.query<{
      table_schema: string;
      table_name: string;
      view_definition: string;
    }>(`
      SELECT
        table_schema,
        table_name,
        view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    return result.rows.map((row) => ({
      name: row.table_name,
      schema: row.table_schema,
      definition: row.view_definition,
    }));
  }

  /**
   * Get all functions
   */
  private async getFunctions(): Promise<FunctionSchema[]> {
    const result = await this.db.query<{
      routine_schema: string;
      routine_name: string;
      data_type: string;
    }>(`
      SELECT
        routine_schema,
        routine_name,
        data_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      ORDER BY routine_name
    `);

    return result.rows.map((row) => ({
      name: row.routine_name,
      schema: row.routine_schema,
      returnType: row.data_type,
      parameters: [], // Simplified for now
    }));
  }

  /**
   * Format schema as text for LLM consumption
   */
  async getSchemaAsText(): Promise<string> {
    const schema = await this.getSchema();
    let text = 'Database Schema:\n\n';

    for (const table of schema.tables) {
      text += `Table: ${table.name}\n`;
      text += `Columns:\n`;

      for (const column of table.columns) {
        const nullable = column.nullable ? 'NULL' : 'NOT NULL';
        const def = column.default ? ` DEFAULT ${column.default}` : '';
        text += `  - ${column.name}: ${column.type} ${nullable}${def}\n`;
      }

      if (table.primaryKeys.length > 0) {
        text += `Primary Key: ${table.primaryKeys.join(', ')}\n`;
      }

      if (table.foreignKeys.length > 0) {
        text += `Foreign Keys:\n`;
        for (const fk of table.foreignKeys) {
          text += `  - ${fk.column} -> ${fk.referencedTable}(${fk.referencedColumn})\n`;
        }
      }

      if (table.indexes.length > 0) {
        text += `Indexes:\n`;
        for (const idx of table.indexes) {
          const unique = idx.unique ? 'UNIQUE' : '';
          text += `  - ${idx.name} ${unique} (${idx.columns.join(', ')})\n`;
        }
      }

      if (table.rowCount) {
        text += `Approximate rows: ${table.rowCount.toLocaleString()}\n`;
      }

      text += '\n';
    }

    if (schema.views.length > 0) {
      text += 'Views:\n';
      for (const view of schema.views) {
        text += `  - ${view.name}\n`;
      }
      text += '\n';
    }

    return text;
  }

  /**
   * Clear the schema cache
   */
  clearCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
    logger.debug('Schema cache cleared');
  }
}
