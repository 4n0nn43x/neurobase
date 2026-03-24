/**
 * Value Explorer Agent (Phase 1C)
 * Inspired by ReFoRCE (Snowflake) column exploration technique
 *
 * Checks if values referenced in NL queries actually exist in the database
 * before generating SQL. E.g., "products in Electronics" → verifies "Electronics" exists.
 */

import { DatabaseAdapter } from '../database/adapter';
import { DatabaseSchema } from '../types';
import { logger } from '../utils/logger';

export interface ExploredValue {
  column: string;
  table: string;
  referencedValue: string;
  actualValues: string[];
  bestMatch?: string;
  exactMatch: boolean;
}

export class ValueExplorerAgent {
  private adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
  }

  /**
   * Detect filter patterns and explore actual DB values
   */
  async explore(queryText: string, schema: DatabaseSchema): Promise<ExploredValue[]> {
    const results: ExploredValue[] = [];

    // Extract potential filter values from the query
    const filterCandidates = this.extractFilterCandidates(queryText, schema);

    if (filterCandidates.length === 0) return results;

    // Query actual values in parallel
    const explorations = filterCandidates.map(async (candidate) => {
      try {
        const actualValues = await this.queryDistinctValues(candidate.table, candidate.column);
        const bestMatch = this.findBestMatch(candidate.value, actualValues);

        return {
          column: candidate.column,
          table: candidate.table,
          referencedValue: candidate.value,
          actualValues: actualValues.slice(0, 20),
          bestMatch: bestMatch || undefined,
          exactMatch: actualValues.some(v => v.toLowerCase() === candidate.value.toLowerCase()),
        };
      } catch (error) {
        logger.debug({ error, table: candidate.table, column: candidate.column }, 'Value exploration failed');
        return null;
      }
    });

    const resolved = await Promise.all(explorations);
    return resolved.filter((r): r is NonNullable<typeof r> => r !== null) as ExploredValue[];
  }

  /**
   * Format explored values as context for the LLM prompt
   */
  formatForPrompt(exploredValues: ExploredValue[]): string {
    if (exploredValues.length === 0) return '';

    let text = '\n# ACTUAL DATABASE VALUES (from value exploration)\n';

    for (const ev of exploredValues) {
      if (ev.exactMatch) {
        text += `- "${ev.referencedValue}" EXISTS in ${ev.table}.${ev.column}\n`;
      } else if (ev.bestMatch) {
        text += `- "${ev.referencedValue}" NOT FOUND in ${ev.table}.${ev.column}. Closest match: "${ev.bestMatch}"\n`;
        text += `  Available values: ${ev.actualValues.slice(0, 10).join(', ')}\n`;
      } else {
        text += `- "${ev.referencedValue}" NOT FOUND in ${ev.table}.${ev.column}\n`;
        text += `  Available values: ${ev.actualValues.slice(0, 10).join(', ')}\n`;
      }
    }

    return text;
  }

  private extractFilterCandidates(
    queryText: string,
    schema: DatabaseSchema
  ): Array<{ table: string; column: string; value: string }> {
    const candidates: Array<{ table: string; column: string; value: string }> = [];

    // Patterns: "in X", "from X", "where X", "category X", "type X", "named X"
    const filterPatterns = [
      /(?:in|from|dans|de)\s+["']?(\w+)["']?/gi,
      /(?:category|categorie|type|status|statut)\s+["']?(\w+)["']?/gi,
      /(?:named?|appel[ée]?e?|nomm[ée]?e?)\s+["']?(\w+[\w\s]*)["']?/gi,
      /["']([^"']+)["']/g,
    ];

    const extractedValues = new Set<string>();
    for (const pattern of filterPatterns) {
      let match;
      while ((match = pattern.exec(queryText)) !== null) {
        const value = match[1].trim();
        // Skip common SQL/English words
        if (value.length > 1 && !this.isStopWord(value)) {
          extractedValues.add(value);
        }
      }
    }

    // Match extracted values against schema columns likely to contain them
    for (const value of extractedValues) {
      for (const table of schema.tables) {
        for (const column of table.columns) {
          // Check text-like columns that could contain the value
          if (this.isTextColumn(column.type) && this.isLikelyFilterColumn(column.name)) {
            candidates.push({ table: table.name, column: column.name, value });
          }
        }
      }
    }

    return candidates;
  }

  private async queryDistinctValues(table: string, column: string): Promise<string[]> {
    const sql = `SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL ORDER BY "${column}" LIMIT 50`;
    const result = await this.adapter.query(sql);
    return result.rows.map((row: any) => String(row[column]));
  }

  private findBestMatch(target: string, candidates: string[]): string | null {
    const lowerTarget = target.toLowerCase();

    // 1. Case-insensitive exact match
    const caseMatch = candidates.find(c => c.toLowerCase() === lowerTarget);
    if (caseMatch) return caseMatch;

    // 2. Plural/singular match
    const pluralMatch = candidates.find(c => {
      const lc = c.toLowerCase();
      return lc === lowerTarget + 's' || lc + 's' === lowerTarget;
    });
    if (pluralMatch) return pluralMatch;

    // 3. Contains match
    const containsMatch = candidates.find(c => c.toLowerCase().includes(lowerTarget) || lowerTarget.includes(c.toLowerCase()));
    if (containsMatch) return containsMatch;

    // 4. Levenshtein distance <= 2
    let bestDist = Infinity;
    let bestCandidate: string | null = null;
    for (const c of candidates) {
      const dist = this.levenshtein(lowerTarget, c.toLowerCase());
      if (dist <= 2 && dist < bestDist) {
        bestDist = dist;
        bestCandidate = c;
      }
    }

    return bestCandidate;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  private isTextColumn(type: string): boolean {
    const textTypes = ['text', 'varchar', 'character varying', 'char', 'character', 'name', 'citext'];
    return textTypes.some(t => type.toLowerCase().includes(t));
  }

  private isLikelyFilterColumn(name: string): boolean {
    const filterColumns = ['name', 'title', 'category', 'type', 'status', 'label', 'tag', 'genre', 'brand', 'department', 'group', 'role'];
    return filterColumns.some(fc => name.toLowerCase().includes(fc));
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'and', 'or',
      'not', 'no', 'but', 'if', 'then', 'else', 'when', 'where', 'how',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
      'some', 'such', 'than', 'too', 'very', 'just', 'because',
      'les', 'des', 'une', 'est', 'sont', 'dans', 'pour', 'avec', 'sur',
      'par', 'qui', 'que', 'dont', 'pas', 'plus', 'tout', 'tous',
      'show', 'list', 'get', 'find', 'select', 'display', 'give', 'me',
      'products', 'users', 'orders', 'items', 'data', 'table', 'tables',
    ]);
    return stopWords.has(word.toLowerCase());
  }
}
