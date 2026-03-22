/**
 * Schema introspection using DatabaseAdapter abstraction
 */

import { DatabaseAdapter } from './adapter';
import {
  DatabaseSchema,
  TableSchema,
  ViewSchema,
  FunctionSchema,
} from '../types';
import { logger } from '../utils/logger';

export class SchemaIntrospector {
  private adapter: DatabaseAdapter;
  private cache: DatabaseSchema | null = null;
  private cacheExpiry: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
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

    logger.debug('Introspecting database schema');

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
    const tableInfos = await this.adapter.getTables();
    const tables: TableSchema[] = [];

    for (const info of tableInfos) {
      const [columns, primaryKeys, foreignKeys, indexes, rowCount] =
        await Promise.all([
          this.adapter.getColumns(info.schema, info.name),
          this.adapter.getPrimaryKeys(info.schema, info.name),
          this.adapter.getForeignKeys(info.schema, info.name),
          this.adapter.getIndexes(info.schema, info.name),
          this.adapter.getRowCount(info.schema, info.name),
        ]);

      tables.push({
        name: info.name,
        schema: info.schema,
        columns: columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          default: c.default,
        })),
        primaryKeys,
        foreignKeys: foreignKeys.map(fk => ({
          column: fk.column,
          referencedTable: fk.referencedTable,
          referencedColumn: fk.referencedColumn,
        })),
        indexes: indexes.map(idx => ({
          name: idx.name,
          columns: idx.columns,
          unique: idx.unique,
          type: idx.type,
        })),
        rowCount,
      });
    }

    return tables;
  }

  /**
   * Get all views
   */
  private async getViews(): Promise<ViewSchema[]> {
    const views = await this.adapter.getViews();
    return views.map(v => ({
      name: v.name,
      schema: v.schema,
      definition: v.definition,
    }));
  }

  /**
   * Get all functions
   */
  private async getFunctions(): Promise<FunctionSchema[]> {
    const functions = await this.adapter.getFunctions();
    return functions.map(f => ({
      name: f.name,
      schema: f.schema,
      returnType: f.returnType,
      parameters: f.parameters,
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
   * Get schema as Mermaid ER diagram
   */
  async getSchemaAsMermaid(): Promise<string> {
    const schema = await this.getSchema();
    let mermaid = 'erDiagram\n';

    for (const table of schema.tables) {
      mermaid += `    ${table.name} {\n`;

      for (const column of table.columns) {
        const isPK = table.primaryKeys.includes(column.name);
        const isFK = table.foreignKeys.some(fk => fk.column === column.name);

        let constraints = [];
        if (isPK) constraints.push('PK');
        if (isFK) constraints.push('FK');
        if (!column.nullable) constraints.push('NOT NULL');

        const constraintStr = constraints.length > 0 ? ` "${constraints.join(', ')}"` : '';
        const typeName = column.type.replace(/\s+/g, '_').replace(/[()]/g, '');

        mermaid += `        ${typeName} ${column.name}${constraintStr}\n`;
      }

      mermaid += `    }\n`;
    }

    mermaid += '\n';
    for (const table of schema.tables) {
      for (const fk of table.foreignKeys) {
        mermaid += `    ${table.name} }o--|| ${fk.referencedTable} : "${fk.column} references ${fk.referencedColumn}"\n`;
      }
    }

    return mermaid;
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
