/**
 * Linguistic Agent - Natural Language to SQL Translation
 */

import {
  Agent,
  LinguisticAgentInput,
  LinguisticAgentOutput,
  LearningEntry,
} from '../types';
import { BaseLLMProvider } from '../llm';
import { logger } from '../utils/logger';

export class LinguisticAgent implements Agent {
  name = 'LinguisticAgent';
  private llm: BaseLLMProvider;

  constructor(llm: BaseLLMProvider) {
    this.llm = llm;
  }

  /**
   * Process natural language query and convert to SQL
   */
  async process(input: LinguisticAgentInput): Promise<LinguisticAgentOutput> {
    const { query, schema, learningHistory } = input;

    logger.info({
      query: query.text.substring(0, 100),
    }, 'Processing natural language query');

    try {
      // Get schema as text
      const schemaText = this.formatSchema(schema);

      // Get relevant examples from learning history
      const examples = this.getRelevantExamples(
        query.text,
        learningHistory || []
      );

      // Generate SQL using LLM
      const result = await this.generateSQL(query.text, schemaText, examples);

      logger.info({
        confidence: result.confidence,
        sqlLength: result.sql.length,
      }, 'SQL generated successfully');

      return {
        sql: result.sql,
        confidence: result.confidence,
        explanation: result.explanation,
        clarificationNeeded: result.confidence < 0.6 ? this.getClarificationQuestion(query.text) : undefined,
        alternatives: result.alternatives,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to generate SQL');
      throw new Error(`Failed to generate SQL: ${error}`);
    }
  }

  /**
   * Generate SQL using the LLM provider
   */
  private async generateSQL(
    query: string,
    schema: string,
    examples: string
  ): Promise<{
    sql: string;
    confidence: number;
    explanation: string;
    alternatives?: string[];
  }> {
    // Check if LLM provider has generateSQL method
    if ('generateSQL' in this.llm && typeof this.llm.generateSQL === 'function') {
      return await (this.llm as any).generateSQL(query, schema, examples);
    }

    // Fallback to generic completion
    const messages = [
      {
        role: 'system' as const,
        content: `You are an expert PostgreSQL query generator. Convert natural language to SQL.

${schema}

${examples ? `Examples:\n${examples}\n` : ''}

Return JSON with: { "sql": "SELECT ...", "explanation": "...", "confidence": 0.9 }`,
      },
      {
        role: 'user' as const,
        content: query,
      },
    ];

    const response = await this.llm.generateCompletion(messages);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          sql: result.sql,
          confidence: result.confidence || 0.7,
          explanation: result.explanation || '',
          alternatives: result.alternatives,
        };
      }
    } catch (e) {
      // Fallback: try to extract SQL
      const sqlMatch = response.content.match(/SELECT[\s\S]*?;/i);
      if (sqlMatch) {
        return {
          sql: sqlMatch[0],
          confidence: 0.5,
          explanation: 'Extracted from response',
        };
      }
    }

    throw new Error('Could not parse SQL from LLM response');
  }

  /**
   * Format database schema for LLM
   */
  private formatSchema(schema: any): string {
    let text = 'Database Schema:\n\n';

    if (schema.tables) {
      for (const table of schema.tables) {
        text += `Table: ${table.name}\n`;
        text += 'Columns:\n';

        for (const column of table.columns) {
          text += `  - ${column.name}: ${column.type}${column.nullable ? ' (nullable)' : ''}\n`;
        }

        if (table.foreignKeys && table.foreignKeys.length > 0) {
          text += 'Relations:\n';
          for (const fk of table.foreignKeys) {
            text += `  - ${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn}\n`;
          }
        }

        text += '\n';
      }
    }

    return text;
  }

  /**
   * Get relevant examples from learning history
   */
  private getRelevantExamples(
    query: string,
    history: LearningEntry[],
    maxExamples: number = 3
  ): string {
    if (!history || history.length === 0) {
      return '';
    }

    // Simple keyword-based relevance (in production, use embeddings)
    const queryWords = query.toLowerCase().split(/\s+/);

    const scored = history
      .filter((entry) => entry.success && !entry.corrected)
      .map((entry) => {
        const nlWords = entry.naturalLanguage.toLowerCase().split(/\s+/);
        const commonWords = queryWords.filter((w) => nlWords.includes(w));
        return {
          entry,
          score: commonWords.length,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxExamples);

    if (scored.length === 0) {
      return '';
    }

    let examples = 'Similar queries from history:\n\n';
    for (const { entry } of scored) {
      examples += `Q: "${entry.naturalLanguage}"\nSQL: ${entry.sql}\n\n`;
    }

    return examples;
  }

  /**
   * Generate a clarification question for ambiguous queries
   */
  private getClarificationQuestion(query: string): string {
    // Simple heuristics for common ambiguities
    if (query.toLowerCase().includes('best') || query.toLowerCase().includes('top')) {
      return 'What metric should be used to determine "best"? (e.g., highest value, most recent, most frequent)';
    }

    if (query.toLowerCase().includes('recent') || query.toLowerCase().includes('latest')) {
      return 'How recent? (e.g., last hour, day, week, month)';
    }

    if (query.toLowerCase().includes('active') || query.toLowerCase().includes('inactive')) {
      return 'What defines "active"? (e.g., last login, recent purchases, account status)';
    }

    return 'Could you provide more details about what you\'re looking for?';
  }

  /**
   * Validate generated SQL (basic syntax check)
   */
  validateSQL(sql: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation
    const upperSQL = sql.toUpperCase().trim();

    // Must start with SELECT, INSERT, UPDATE, DELETE, or WITH
    if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)\s/.test(upperSQL)) {
      errors.push('SQL must start with SELECT, INSERT, UPDATE, DELETE, or WITH');
    }

    // Check for balanced parentheses
    const openParens = (sql.match(/\(/g) || []).length;
    const closeParens = (sql.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push('Unbalanced parentheses');
    }

    // Check for SQL injection patterns (basic)
    const dangerousPatterns = [
      /;\s*DROP/i,
      /;\s*DELETE\s+FROM/i,
      /;\s*TRUNCATE/i,
      /--.*DROP/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sql)) {
        errors.push('Potentially dangerous SQL pattern detected');
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
