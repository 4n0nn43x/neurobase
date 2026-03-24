/**
 * Schema Pruner (Phase 2C)
 * Inspired by DB-GPT, Wren AI "smart context discovery"
 *
 * For large schemas (100+ tables), sends only relevant tables to the LLM
 * based on query keywords, FK proximity, and historical frequency.
 */

import { DatabaseSchema, TableSchema } from '../types';
import { logger } from '../utils/logger';

export interface PruneOptions {
  tokenBudget?: number;
  tier?: 1 | 2 | 3 | 4;
}

export class SchemaPruner {
  private queryFrequency: Map<string, number> = new Map();
  private defaultBudget = 4000;

  /**
   * Record table usage frequency from queries
   */
  recordTableUsage(tableName: string): void {
    const count = this.queryFrequency.get(tableName) || 0;
    this.queryFrequency.set(tableName, count + 1);
  }

  /**
   * Prune schema to fit within token budget, keeping most relevant tables
   */
  prune(schema: DatabaseSchema, queryText: string, options?: PruneOptions): string {
    const budget = this.getBudget(options);

    // For small schemas, skip pruning
    if (schema.tables.length <= 10) {
      return this.formatFull(schema);
    }

    // Score each table
    const scored = schema.tables.map(table => ({
      table,
      score: this.scoreTable(table, queryText, schema),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Serialize tables until budget reached
    let text = 'Database Schema:\n\n';
    let usedTokens = 20; // Header
    const includedTables = new Set<string>();

    for (const { table } of scored) {
      const tableText = this.formatTableFull(table);
      const tableTokens = this.estimateTokens(tableText);

      if (usedTokens + tableTokens <= budget) {
        text += tableText;
        usedTokens += tableTokens;
        includedTables.add(table.name);
      } else {
        // Compact format for borderline tables
        const compactText = this.formatTableCompact(table);
        const compactTokens = this.estimateTokens(compactText);

        if (usedTokens + compactTokens <= budget) {
          text += compactText;
          usedTokens += compactTokens;
          includedTables.add(table.name);
        } else {
          break;
        }
      }
    }

    // Add FK-connected tables that were missed
    const fkTables = this.getFKConnectedTables(includedTables, schema);
    for (const tableName of fkTables) {
      if (includedTables.has(tableName)) continue;
      const table = schema.tables.find(t => t.name === tableName);
      if (!table) continue;

      const compactText = this.formatTableCompact(table);
      const compactTokens = this.estimateTokens(compactText);

      if (usedTokens + compactTokens <= budget) {
        text += compactText;
        usedTokens += compactTokens;
        includedTables.add(tableName);
      }
    }

    logger.debug({
      totalTables: schema.tables.length,
      includedTables: includedTables.size,
      estimatedTokens: usedTokens,
    }, 'Schema pruned');

    return text;
  }

  private scoreTable(table: TableSchema, queryText: string, _schema: DatabaseSchema): number {
    let score = 0;
    const lowerQuery = queryText.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);

    // 1. Table name overlap with query
    const lowerTableName = table.name.toLowerCase();
    if (lowerQuery.includes(lowerTableName)) {
      score += 10;
    }
    // Partial matches (e.g., "product" matches "products")
    for (const word of queryWords) {
      if (lowerTableName.includes(word) || word.includes(lowerTableName)) {
        score += 5;
      }
    }

    // 2. Column name overlap with query
    for (const col of table.columns) {
      const lowerCol = col.name.toLowerCase();
      for (const word of queryWords) {
        if (lowerCol.includes(word) || word.includes(lowerCol)) {
          score += 2;
        }
      }
      // Description overlap
      if (col.description) {
        const lowerDesc = col.description.toLowerCase();
        for (const word of queryWords) {
          if (lowerDesc.includes(word)) {
            score += 1;
          }
        }
      }
    }

    // 3. FK proximity — tables referenced by high-scoring tables
    const fkTargets = table.foreignKeys.map(fk => fk.referencedTable.toLowerCase());
    for (const target of fkTargets) {
      for (const word of queryWords) {
        if (target.includes(word)) {
          score += 3;
        }
      }
    }

    // 4. Historical frequency
    const freq = this.queryFrequency.get(table.name) || 0;
    score += Math.min(freq, 5); // Cap at 5

    return score;
  }

  private getBudget(options?: PruneOptions): number {
    if (options?.tokenBudget) return options.tokenBudget;

    // Tier influences budget
    switch (options?.tier) {
      case 1:
      case 2:
        return 2000; // Minimal for cache hits
      case 3:
        return 4000; // Standard
      case 4:
        return 6000; // Maximum for LLM fallback
      default:
        return this.defaultBudget;
    }
  }

  private getFKConnectedTables(included: Set<string>, schema: DatabaseSchema): string[] {
    const connected = new Set<string>();
    for (const table of schema.tables) {
      if (!included.has(table.name)) continue;
      for (const fk of table.foreignKeys) {
        if (!included.has(fk.referencedTable)) {
          connected.add(fk.referencedTable);
        }
      }
    }
    // Also add tables that reference included tables
    for (const table of schema.tables) {
      if (included.has(table.name)) continue;
      for (const fk of table.foreignKeys) {
        if (included.has(fk.referencedTable)) {
          connected.add(table.name);
        }
      }
    }
    return Array.from(connected);
  }

  private formatFull(schema: DatabaseSchema): string {
    let text = 'Database Schema:\n\n';
    for (const table of schema.tables) {
      text += this.formatTableFull(table);
    }
    return text;
  }

  private formatTableFull(table: TableSchema): string {
    let text = `Table: ${table.name}\n`;
    text += 'Columns:\n';
    for (const col of table.columns) {
      text += `  - ${col.name}: ${col.type}${col.nullable ? ' (nullable)' : ''}`;
      if (col.description) text += ` — ${col.description}`;
      text += '\n';
    }
    if (table.foreignKeys.length > 0) {
      text += 'Relations:\n';
      for (const fk of table.foreignKeys) {
        text += `  - ${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn}\n`;
      }
    }
    text += '\n';
    return text;
  }

  private formatTableCompact(table: TableSchema): string {
    const keyColumns = table.columns
      .filter(c =>
        table.primaryKeys.includes(c.name) ||
        table.foreignKeys.some(fk => fk.column === c.name) ||
        c.name.toLowerCase().includes('name') ||
        c.name.toLowerCase().includes('title') ||
        c.name.toLowerCase().includes('type') ||
        c.name.toLowerCase().includes('status')
      )
      .map(c => `${c.name}:${c.type}`)
      .join(', ');

    return `Table: ${table.name} [${keyColumns}] (${table.columns.length} cols)\n`;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}
