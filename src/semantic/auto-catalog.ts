/**
 * Semantic Catalog Auto-Generator (Phase 2A)
 * Inspired by pgai Semantic Catalog (Timescale)
 *
 * Auto-generates human-readable descriptions for tables and columns
 * by analyzing names, types, and optional data samples via LLM.
 */

import { DatabaseAdapter } from '../database/adapter';
import { BaseLLMProvider, LLMMessage } from '../llm/base';
import { DatabaseSchema, TableSchema } from '../types';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

export interface CatalogEntry {
  table: string;
  tableDescription: string;
  columns: Record<string, string>;
}

export class SemanticCatalogGenerator {
  private adapter: DatabaseAdapter;
  private llm: BaseLLMProvider;
  private privacyMode: 'strict' | 'schema-only' | 'permissive';
  private catalog: Map<string, CatalogEntry> = new Map();
  private initialized = false;

  constructor(
    adapter: DatabaseAdapter,
    llm: BaseLLMProvider,
    privacyMode: 'strict' | 'schema-only' | 'permissive' = 'schema-only'
  ) {
    this.adapter = adapter;
    this.llm = llm;
    this.privacyMode = privacyMode;
  }

  /**
   * Initialize catalog — loads from DB or generates.
   * Runs as background task, does not block startup.
   */
  async initialize(schema: DatabaseSchema): Promise<void> {
    try {
      // Try to load existing catalog from DB
      await this.loadFromDB();

      // Check if schema has changed
      const currentHash = this.hashSchema(schema);
      const storedHash = await this.getStoredHash();

      if (storedHash !== currentHash || this.catalog.size === 0) {
        logger.debug('Schema changed or catalog empty, regenerating descriptions');
        await this.generate(schema);
        await this.saveToDB(currentHash);
      }

      this.initialized = true;
      logger.debug({ tables: this.catalog.size }, 'Semantic catalog initialized');
    } catch (error) {
      logger.warn({ error }, 'Semantic catalog initialization failed, continuing without');
    }
  }

  /**
   * Enrich a schema with catalog descriptions
   */
  enrichSchema(schema: DatabaseSchema): DatabaseSchema {
    if (!this.initialized || this.catalog.size === 0) return schema;

    return {
      ...schema,
      tables: schema.tables.map(table => {
        const entry = this.catalog.get(table.name);
        if (!entry) return table;

        return {
          ...table,
          columns: table.columns.map(col => ({
            ...col,
            description: entry.columns[col.name] || col.description,
          })),
        };
      }),
    };
  }

  /**
   * Get catalog description for a table
   */
  getTableDescription(tableName: string): string | undefined {
    return this.catalog.get(tableName)?.tableDescription;
  }

  private async generate(schema: DatabaseSchema): Promise<void> {
    for (const table of schema.tables) {
      try {
        const entry = await this.generateTableCatalog(table);
        this.catalog.set(table.name, entry);
      } catch (error) {
        logger.debug({ error, table: table.name }, 'Failed to generate catalog for table');
      }
    }
  }

  private async generateTableCatalog(table: TableSchema): Promise<CatalogEntry> {
    let sampleText = '';

    // Include sample data only in permissive mode
    if (this.privacyMode === 'permissive') {
      try {
        const sample = await this.adapter.query(
          `SELECT * FROM "${table.name}" LIMIT 3`
        );
        if (sample.rows.length > 0) {
          sampleText = `\nSample data (3 rows):\n${JSON.stringify(sample.rows, null, 2)}`;
        }
      } catch {
        // Skip sample on error
      }
    }

    const columnsInfo = table.columns
      .map(c => `  ${c.name}: ${c.type}${c.nullable ? ' (nullable)' : ''}${c.default ? ` default=${c.default}` : ''}`)
      .join('\n');

    const fkInfo = table.foreignKeys.length > 0
      ? `\nForeign keys:\n${table.foreignKeys.map(fk => `  ${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn}`).join('\n')}`
      : '';

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You generate concise, helpful descriptions for database tables and columns. Output valid JSON only.`,
      },
      {
        role: 'user',
        content: `Describe this table and each column in plain language (1 sentence each).

Table: ${table.name}
Columns:
${columnsInfo}${fkInfo}${sampleText}

Return JSON:
{
  "tableDescription": "...",
  "columns": { "column_name": "description", ... }
}`,
      },
    ];

    const response = await this.llm.generateCompletion(messages, { temperature: 0.1, maxTokens: 1000 });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          table: table.name,
          tableDescription: parsed.tableDescription || '',
          columns: parsed.columns || {},
        };
      }
    } catch {
      // Fallback: generate basic descriptions from names
    }

    return {
      table: table.name,
      tableDescription: `Table containing ${table.name} data`,
      columns: Object.fromEntries(
        table.columns.map(c => [c.name, `${c.type} column`])
      ),
    };
  }

  private async loadFromDB(): Promise<void> {
    try {
      const result = await this.adapter.query(
        `SELECT table_name, table_description, column_descriptions FROM neurobase_semantic_catalog`
      );

      for (const row of result.rows) {
        this.catalog.set(row.table_name, {
          table: row.table_name,
          tableDescription: row.table_description,
          columns: typeof row.column_descriptions === 'string'
            ? JSON.parse(row.column_descriptions)
            : row.column_descriptions,
        });
      }
    } catch {
      // Table doesn't exist yet — will be created on first save
    }
  }

  private async saveToDB(schemaHash: string): Promise<void> {
    try {
      await this.adapter.execute(`
        CREATE TABLE IF NOT EXISTS neurobase_semantic_catalog (
          table_name TEXT PRIMARY KEY,
          table_description TEXT,
          column_descriptions JSONB,
          schema_hash TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      for (const [tableName, entry] of this.catalog) {
        await this.adapter.execute(`
          INSERT INTO neurobase_semantic_catalog (table_name, table_description, column_descriptions, schema_hash)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (table_name) DO UPDATE SET
            table_description = $2,
            column_descriptions = $3,
            schema_hash = $4,
            updated_at = NOW()
        `, [tableName, entry.tableDescription, JSON.stringify(entry.columns), schemaHash]);
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to save semantic catalog to DB');
    }
  }

  private async getStoredHash(): Promise<string | null> {
    try {
      const result = await this.adapter.query(
        `SELECT schema_hash FROM neurobase_semantic_catalog LIMIT 1`
      );
      return result.rows[0]?.schema_hash || null;
    } catch {
      return null;
    }
  }

  private hashSchema(schema: DatabaseSchema): string {
    const ddl = schema.tables
      .map(t => `${t.name}:${t.columns.map(c => `${c.name}:${c.type}`).join(',')}`)
      .sort()
      .join('|');
    return crypto.createHash('md5').update(ddl).digest('hex');
  }
}
