/**
 * Query Explainer Agent (Phase 3C)
 * Inspired by Chat2DB, Wren AI
 *
 * Generates a human-readable explanation AFTER query execution,
 * describing what the results mean in natural language.
 */

import { BaseLLMProvider, LLMMessage } from '../llm/base';
import { logger } from '../utils/logger';

export class QueryExplainerAgent {
  private llm: BaseLLMProvider;
  private privacyAllowsRows: boolean;

  constructor(llm: BaseLLMProvider, privacyAllowsRows: boolean = false) {
    this.llm = llm;
    this.privacyAllowsRows = privacyAllowsRows;
  }

  /**
   * Generate a post-execution explanation
   */
  async explain(params: {
    originalQuery: string;
    sql: string;
    rowCount: number;
    columns?: string[];
    sampleRows?: any[];
  }): Promise<string> {
    const { originalQuery, sql, rowCount, columns, sampleRows } = params;

    let dataContext = '';
    if (this.privacyAllowsRows && sampleRows && sampleRows.length > 0) {
      dataContext = `\nFirst rows preview:\n${JSON.stringify(sampleRows.slice(0, 3), null, 2)}`;
    }
    if (columns && columns.length > 0) {
      dataContext += `\nResult columns: ${columns.join(', ')}`;
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You explain SQL query results in plain language. Be concise (1-2 sentences). Describe WHAT was found, not HOW the SQL works.`,
      },
      {
        role: 'user',
        content: `Question: "${originalQuery}"
SQL executed: ${sql}
Rows returned: ${rowCount}${dataContext}

Explain the result in plain language:`,
      },
    ];

    try {
      const response = await this.llm.generateCompletion(messages, {
        temperature: 0.1,
        maxTokens: 200,
      });
      return response.content.trim();
    } catch (error) {
      logger.debug({ error }, 'Explainer failed, using fallback');
      return `Query returned ${rowCount} row${rowCount !== 1 ? 's' : ''}.`;
    }
  }
}
