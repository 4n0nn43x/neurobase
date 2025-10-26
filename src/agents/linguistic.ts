/**
 * Linguistic Agent - Natural Language to SQL Translation
 */

import {
  Agent,
  LinguisticAgentInput,
  LinguisticAgentOutput,
  LearningEntry,
  MissingColumnInfo,
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

    logger.debug({
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

      // Extract conversation context if available
      const conversationContext = query.context?.conversationContext;

      // Generate SQL using LLM
      const result = await this.generateSQL(query.text, schemaText, examples, conversationContext);

      logger.debug({
        confidence: result.confidence,
        sqlLength: result.sql.length,
      }, 'SQL generated successfully');

      // Check for missing required columns in INSERT/UPDATE statements
      const missingData = this.detectMissingColumns(result.sql, schema);

      return {
        sql: result.sql,
        confidence: result.confidence,
        explanation: result.explanation,
        clarificationNeeded: result.confidence < 0.6 ? this.getClarificationQuestion(query.text) : undefined,
        alternatives: result.alternatives,
        missingData,
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
    examples: string,
    conversationContext?: string
  ): Promise<{
    sql: string;
    confidence: number;
    explanation: string;
    alternatives?: string[];
  }> {
    // Check if LLM provider has generateSQL method
    if ('generateSQL' in this.llm && typeof this.llm.generateSQL === 'function') {
      return await (this.llm as any).generateSQL(query, schema, examples, conversationContext);
    }

    // Fallback to generic completion
    const messages = [
      {
        role: 'system' as const,
        content: `You are an elite PostgreSQL expert with deep natural language understanding capabilities. Transform human queries into precise, optimized SQL while maintaining contextual awareness.

# DATABASE SCHEMA
${schema}

${examples ? `# PROVEN SUCCESSFUL EXAMPLES\n${examples}\n` : ''}

${conversationContext ? `# CONVERSATION HISTORY\n${conversationContext}\n\n` : ''}

# SQL GENERATION GUIDELINES

## Metadata Queries
When users ask about database structure (not data), query system catalogs:
- "show all tables" / "quelles sont les tables" / "quel sont toutes les tables" → SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
- "list tables" → Same as above
- "show columns" → Query information_schema.columns

## Column Reference Intelligence
When users explicitly name columns, they want VALUES:
- "what are parent_id values?" / "quels sont les parent_id?" → SELECT DISTINCT parent_id FROM table ORDER BY parent_id
- "show me prices" / "montre les prix" → SELECT DISTINCT price FROM products ORDER BY price

When users ask conceptually (no column name):
- "show parent categories" / "montre les parents" → SELECT * FROM categories WHERE parent_id IS NULL

## Contextual Understanding (CRITICAL)
Vague follow-up queries reference the previous conversation:
- "I want the values" / "je veux les valeurs" → Enhance previous query with aggregation
- "with description" / "avec la description" → JOIN to related table for description field
- "and their names" / "et leurs noms" → Add name column via JOIN

## Multi-Language Support
Handle English, French, and mixed queries equally:
- French: "quels", "montre", "avec", "leurs"
- English: "what", "show", "with", "their"
- Mixed: Valid and expected

## Output Requirements
- Valid PostgreSQL syntax (version 12+)
- Performance-optimized (proper JOINs, indexes considered)
- Handle NULLs appropriately
- Use DISTINCT when showing unique values
- Add ORDER BY for better UX

## Conversational Clarification (CRITICAL)
When query is ambiguous or vague, ASK instead of guessing:
- Set needsClarification: true
- Provide clarificationQuestion asking what user means
- Offer 2-4 suggestedInterpretations with SQL examples

When CLEAR: confidence 0.7+, needsClarification=false
When AMBIGUOUS: confidence <0.7, needsClarification=true, include clarificationQuestion and suggestedInterpretations array`,
      },
      {
        role: 'user' as const,
        content: `Query: "${query}"\n\nGenerate PostgreSQL query.`,
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

  /**
   * Detect missing required columns in INSERT/UPDATE statements
   */
  private detectMissingColumns(
    sql: string,
    schema: any
  ): { table: string; columns: MissingColumnInfo[]; reason: string } | undefined {
    // Parse INSERT statement
    const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);

    if (!insertMatch) {
      return undefined; // Not an INSERT statement
    }

    const tableName = insertMatch[1];
    const providedColumnsStr = insertMatch[2];
    const providedColumns = providedColumnsStr
      .split(',')
      .map((col) => col.trim().toLowerCase());

    // Find the table schema
    const table = schema.tables?.find((t: any) => t.name.toLowerCase() === tableName.toLowerCase());

    if (!table) {
      return undefined; // Table not found in schema
    }

    // Find required columns (NOT NULL and no default value)
    const missingColumns: MissingColumnInfo[] = [];

    for (const column of table.columns) {
      const isProvided = providedColumns.includes(column.name.toLowerCase());
      const isRequired = !column.nullable && !column.default && column.name.toLowerCase() !== 'id';

      if (isRequired && !isProvided) {
        // Determine possible values or suggestions based on column type
        const columnInfo: MissingColumnInfo = {
          column: column.name,
          type: column.type,
          description: column.description,
        };

        // Add suggestions based on column name and type
        if (column.name.toLowerCase().includes('price')) {
          columnInfo.possibleValues = ['0.00', '9.99', '19.99', '49.99', '99.99'];
        } else if (column.name.toLowerCase().includes('stock')) {
          columnInfo.possibleValues = ['0', '10', '50', '100'];
        } else if (column.name.toLowerCase().includes('category')) {
          columnInfo.possibleValues = ['Electronics', 'Clothing', 'Food', 'Books', 'Other'];
        } else if (column.type.toLowerCase().includes('bool')) {
          columnInfo.possibleValues = ['true', 'false'];
        } else if (column.type.toLowerCase().includes('int')) {
          columnInfo.defaultValue = '0';
        } else if (column.type.toLowerCase().includes('numeric') || column.type.toLowerCase().includes('decimal')) {
          columnInfo.defaultValue = '0.00';
        } else {
          columnInfo.defaultValue = '';
        }

        missingColumns.push(columnInfo);
      }
    }

    if (missingColumns.length > 0) {
      return {
        table: tableName,
        columns: missingColumns,
        reason: `Missing required column(s): ${missingColumns.map((c) => c.column).join(', ')}`,
      };
    }

    return undefined;
  }
}
