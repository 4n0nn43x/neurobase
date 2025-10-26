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
        isConversational: result.isConversational,
        conversationalResponse: result.conversationalResponse,
        needsClarification: result.needsClarification,
        clarificationQuestion: result.clarificationQuestion,
        suggestedInterpretations: result.suggestedInterpretations,
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
    isConversational?: boolean;
    conversationalResponse?: string;
    needsClarification?: boolean;
    clarificationQuestion?: string;
    suggestedInterpretations?: Array<{ description: string; sql: string }>;
  }> {
    // Check if LLM provider has generateSQL method
    if ('generateSQL' in this.llm && typeof this.llm.generateSQL === 'function') {
      return await (this.llm as any).generateSQL(query, schema, examples, conversationContext);
    }

    // Fallback to generic completion
    const messages = [
      {
        role: 'system' as const,
        content: `You are an elite PostgreSQL expert with deep natural language understanding. You intelligently handle both conversational interactions and SQL query generation.

# DATABASE SCHEMA
${schema}

${examples ? `# SUCCESSFUL EXAMPLES\n${examples}\n` : ''}

${conversationContext ? `# CONVERSATION HISTORY\n${conversationContext}\n\n` : ''}

# CORE CAPABILITY: Conversation vs SQL Detection

## CONVERSATIONAL inputs (respond naturally, NO SQL):
- Greetings: "hello", "hi", "bonjour", "salut"
- Help: "what can you do?", "comment tu peux m'aider?", "que peux tu faire?"
- Meta: "what did I ask?", "selon toi qu'est-ce que je demande?"

Response format for conversational:
{ "isConversational": true, "conversationalResponse": "helpful response", "sql": "", "confidence": 1.0 }

## SQL QUERY inputs:
- Data: "show products", "list users", "combien d'utilisateurs?"
- Aggregations: "count orders", "sum sales"
- Metadata: "what tables?", "quelles tables?"

# SQL GENERATION GUIDELINES (when isConversational=false)

## Metadata Queries
- "show tables" / "quelles tables" → SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename

## Multi-Language Support
Handle English, French, mixed queries equally.

## Ambiguity Handling
When ambiguous: needsClarification=true, provide clarificationQuestion and suggestedInterpretations

## Fuzzy Matching for Referenced Values (CRITICAL)
When users reference values (category names, etc.) that don't match exactly:
1. Try case-insensitive match: "electronic" matches "Electronics"
2. Try singular/plural: "electronic" matches "electronics"
3. If close match found (1-2 char difference): ASK FOR CLARIFICATION with options:
   - Use existing similar value
   - Create new value
4. Use ILIKE or LOWER() for case-insensitive WHERE clauses
5. Example: WHERE LOWER(name) = LOWER('electronic') instead of WHERE name = 'electronic'

When value doesn't exist, set needsClarification=true and provide:
- clarificationQuestion: "Category 'X' not found. Did you mean 'Y'? Or create new?"
- suggestedInterpretations: Array with options (use existing, create new)

## Output
Valid PostgreSQL, performance-optimized, handle NULLs, use DISTINCT and ORDER BY`,
      },
      {
        role: 'user' as const,
        content: `User input: "${query}"\n\nAnalyze and respond.`,
      },
    ];

    const response = await this.llm.generateCompletion(messages);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          sql: result.sql || '',
          confidence: result.confidence || 0.7,
          explanation: result.explanation || '',
          alternatives: result.alternatives,
          isConversational: result.isConversational || false,
          conversationalResponse: result.conversationalResponse,
          needsClarification: result.needsClarification || false,
          clarificationQuestion: result.clarificationQuestion,
          suggestedInterpretations: result.suggestedInterpretations,
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
          isConversational: false,
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
