/**
 * Self-Correction Loop (Phase 1A)
 * Inspired by PremSQL, ReFoRCE (Snowflake)
 *
 * When SQL execution fails, retries with error context
 * sent back to the LLM for correction (max 3 attempts).
 */

import { BaseLLMProvider, LLMMessage } from '../llm/base';
import { CorrectionAttempt, SelfCorrectionResult, DatabaseSchema } from '../types';
import { withSpan } from '../observability/spans';
import { logger } from '../utils/logger';

export class SelfCorrectionLoop {
  private llm: BaseLLMProvider;
  private maxAttempts = 3;
  private temperatures = [0.1, 0.3, 0.5];

  constructor(llm: BaseLLMProvider) {
    this.llm = llm;
  }

  /**
   * One-shot correction — produces a corrected SQL but does NOT execute it.
   * The caller is responsible for running and validating the result.
   *
   * Note: the previous version had a stray `return` inside a `for` loop
   * which made `maxAttempts` dead code. By contract this method does ONE
   * attempt — for retry-on-failure semantics, use `correctWithExecution`
   * which actually iterates.
   */
  async correct(
    naturalLanguageQuery: string,
    failedSQL: string,
    dbError: string,
    schema: DatabaseSchema,
  ): Promise<SelfCorrectionResult> {
    return withSpan('linguistic.translate', async (span) => {
      span.setAttribute('correction.type', 'self-correction-oneshot');
      const temperature = this.temperatures[0];

      const correctedSQL = await this.requestCorrection(
        naturalLanguageQuery,
        failedSQL,
        dbError,
        schema,
        temperature,
      );

      return {
        success: true,
        finalSQL: correctedSQL,
        attempts: [{ attempt: 1, sql: correctedSQL, error: dbError, temperature }],
        originalError: dbError,
      };
    });
  }

  async correctWithExecution(
    naturalLanguageQuery: string,
    failedSQL: string,
    dbError: string,
    schema: DatabaseSchema,
    executor: (sql: string) => Promise<{ rows: any[]; rowCount: number | null }>
  ): Promise<SelfCorrectionResult> {
    const attempts: CorrectionAttempt[] = [];
    let lastError = dbError;
    let lastSQL = failedSQL;

    for (let i = 0; i < this.maxAttempts; i++) {
      const temperature = this.temperatures[i];

      logger.debug({
        attempt: i + 1,
        temperature,
        error: lastError.substring(0, 100),
      }, 'Self-correction attempt');

      const correctedSQL = await this.requestCorrection(
        naturalLanguageQuery,
        lastSQL,
        lastError,
        schema,
        temperature
      );

      attempts.push({
        attempt: i + 1,
        sql: correctedSQL,
        error: lastError,
        temperature,
      });

      try {
        await executor(correctedSQL);

        logger.debug({ attempt: i + 1 }, 'Self-correction succeeded');
        return {
          success: true,
          finalSQL: correctedSQL,
          attempts,
          originalError: dbError,
        };
      } catch (execError) {
        lastError = execError instanceof Error ? execError.message : String(execError);
        lastSQL = correctedSQL;
        logger.debug({ attempt: i + 1, error: lastError.substring(0, 100) }, 'Correction attempt failed');
      }
    }

    logger.warn({ attempts: this.maxAttempts }, 'Self-correction exhausted all attempts');
    return {
      success: false,
      finalSQL: lastSQL,
      attempts,
      originalError: dbError,
    };
  }

  private async requestCorrection(
    naturalLanguageQuery: string,
    failedSQL: string,
    errorMessage: string,
    schema: DatabaseSchema,
    temperature: number
  ): Promise<string> {
    const schemaText = schema.tables
      .map(t => `${t.name}(${t.columns.map(c => `${c.name}: ${c.type}`).join(', ')})`)
      .join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a SQL correction expert. A SQL query failed. Fix it based on the error message and schema.

# SCHEMA
${schemaText}

# RULES
- Return ONLY the corrected SQL, nothing else
- Do NOT wrap in code blocks or JSON
- Fix the specific error while preserving the original intent
- Use correct table/column names from the schema`,
      },
      {
        role: 'user',
        content: `Original question: "${naturalLanguageQuery}"
Failed SQL: ${failedSQL}
Error: ${errorMessage}

Provide the corrected SQL:`,
      },
    ];

    const response = await this.llm.generateCompletion(messages, { temperature });
    return response.content.trim().replace(/^```sql?\n?/i, '').replace(/\n?```$/i, '').trim();
  }
}
