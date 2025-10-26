/**
 * NeuroBase Core - Main orchestrator for the intelligent database system
 */

import { Config, NaturalLanguageQuery, QueryResult, EventHandler, NeuroBaseEvent } from '../types';
import { DatabaseConnection } from '../database/connection';
import { SchemaIntrospector } from '../database/schema';
import { LLMFactory, BaseLLMProvider } from '../llm';
import { LinguisticAgent } from '../agents/linguistic';
import { OptimizerAgent } from '../agents/optimizer';
import { MemoryAgent } from '../agents/memory';
import { logger } from '../utils/logger';

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class NeuroBase {
  private config: Config;
  private db: DatabaseConnection;
  private schema: SchemaIntrospector;
  private llm: BaseLLMProvider;
  private linguisticAgent: LinguisticAgent;
  private optimizerAgent: OptimizerAgent;
  private memoryAgent: MemoryAgent;
  private eventHandlers: EventHandler[] = [];
  // @ts-expect-error - Reserved for future conversation context tracking
  private _conversationContext: Map<string, any[]> = new Map();

  constructor(config: Config) {
    this.config = config;

    // Initialize database connection
    this.db = new DatabaseConnection(config.tiger);

    // Initialize schema introspector
    this.schema = new SchemaIntrospector(this.db);

    // Initialize LLM provider
    this.llm = LLMFactory.create(config.llm);

    // Initialize agents
    this.linguisticAgent = new LinguisticAgent(this.llm);
    this.optimizerAgent = new OptimizerAgent(this.db, this.llm);
    this.memoryAgent = new MemoryAgent(this.db, this.llm);

    logger.info({
      mode: config.neurobase.mode,
      llmProvider: config.llm.provider,
    }, 'NeuroBase initialized');
  }

  /**
   * Initialize NeuroBase (test connection, setup tables, etc.)
   */
  async initialize(): Promise<void> {
    logger.info('Starting NeuroBase initialization');

    // Test database connection
    const connected = await this.db.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize memory storage tables
    if (this.config.features.enableLearning) {
      await this.memoryAgent.initializeStorage();
    }

    // Introspect schema
    await this.schema.getSchema();

    logger.info('NeuroBase initialization complete');
  }

  /**
   * Process a natural language query
   */
  async query(query: string | NaturalLanguageQuery): Promise<QueryResult> {
    const nlQuery: NaturalLanguageQuery =
      typeof query === 'string' ? { text: query } : query;

    const startTime = Date.now();

    logger.info({
      query: nlQuery.text.substring(0, 100),
      userId: nlQuery.userId,
      conversationId: nlQuery.conversationId,
    }, 'Processing query');

    this.emitEvent({
      type: 'query:start',
      payload: { query: nlQuery.text },
    });

    try {
      // Step 1: Translate natural language to SQL
      const dbSchema = await this.schema.getSchema();

      // Get learning history for context
      const learningHistory = this.config.features.enableLearning
        ? await this.memoryAgent.getHistory(nlQuery.userId, 20)
        : [];

      const linguisticResult = await this.linguisticAgent.process({
        query: nlQuery,
        schema: dbSchema,
        learningHistory,
      });

      // Check if clarification is needed
      if (linguisticResult.clarificationNeeded) {
        logger.info({
          clarification: linguisticResult.clarificationNeeded,
        }, 'Clarification needed');

        return {
          data: [],
          sql: linguisticResult.sql,
          executionTime: Date.now() - startTime,
          rowCount: 0,
          explanation: linguisticResult.explanation,
          suggestions: [linguisticResult.clarificationNeeded],
        };
      }

      let finalSQL = linguisticResult.sql;

      // Step 2: Optimize query if enabled
      if (this.config.features.enableOptimization) {
        const optimizerResult = await this.optimizerAgent.process({
          sql: finalSQL,
          schema: dbSchema,
        });

        if (optimizerResult.applied) {
          finalSQL = optimizerResult.optimizedSQL;
          logger.info({
            originalSQL: linguisticResult.sql.substring(0, 50),
            optimizedSQL: finalSQL.substring(0, 50),
          }, 'Query optimized');
        }
      }

      // Step 3: Execute query
      const result = await this.db.query(finalSQL, undefined, {
        timeout: this.config.security.maxQueryTime,
      });

      const executionTime = Date.now() - startTime;

      // Step 4: Learn from this interaction
      if (this.config.features.enableLearning) {
        await this.memoryAgent.process({
          action: 'store',
          entry: {
            id: uuidv4(),
            naturalLanguage: nlQuery.text,
            sql: finalSQL,
            userId: nlQuery.userId,
            timestamp: new Date(),
            success: true,
            corrected: false,
          },
        });
      }

      const queryResult: QueryResult = {
        data: result.rows,
        sql: finalSQL,
        executionTime,
        rowCount: result.rowCount || 0,
        explanation: linguisticResult.explanation,
        learned: this.config.features.enableLearning,
      };

      this.emitEvent({
        type: 'query:complete',
        payload: queryResult,
      });

      logger.info({
        rowCount: queryResult.rowCount,
        executionTime,
      }, 'Query completed successfully');

      return queryResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error({
        query: nlQuery.text.substring(0, 100),
        error: errorMessage,
      }, 'Query failed');

      this.emitEvent({
        type: 'query:error',
        payload: { error: error as Error },
      });

      throw error;
    }
  }

  /**
   * Correct a previous query
   */
  async correct(
    originalQuery: string,
    correctSQL: string,
    reason?: string
  ): Promise<void> {
    if (!this.config.features.enableLearning) {
      logger.warn('Learning is disabled, correction not stored');
      return;
    }

    // Store the correction
    await this.memoryAgent.storeCorrection({
      originalQuery,
      originalSQL: '', // We'd need to fetch this from history
      correctedSQL: correctSQL,
      reason: reason || 'User correction',
      timestamp: new Date(),
    });

    logger.info({
      originalQuery: originalQuery.substring(0, 50),
    }, 'Correction stored');
  }

  /**
   * Get query suggestions based on schema and history
   */
  async getSuggestions(userId?: string): Promise<string[]> {
    const suggestions: string[] = [];

    // Get schema
    const dbSchema = await this.schema.getSchema();

    // Suggest based on available tables
    if (dbSchema.tables.length > 0) {
      const mainTable = dbSchema.tables[0];
      suggestions.push(`Show me all data from ${mainTable.name}`);
      suggestions.push(`How many records are in ${mainTable.name}?`);

      // If there are foreign keys, suggest joins
      if (mainTable.foreignKeys.length > 0) {
        const fk = mainTable.foreignKeys[0];
        suggestions.push(
          `Show ${mainTable.name} with related ${fk.referencedTable} data`
        );
      }
    }

    // Get common queries from history
    if (this.config.features.enableLearning && userId) {
      const history = await this.memoryAgent.getHistory(userId, 5);
      const commonQueries = history
        .filter((entry) => entry.success && !entry.corrected)
        .slice(0, 3)
        .map((entry) => entry.naturalLanguage);

      suggestions.push(...commonQueries);
    }

    return [...new Set(suggestions)]; // Remove duplicates
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<any> {
    const [dbStats, schema] = await Promise.all([
      this.db.getDatabaseStats(),
      this.schema.getSchema(),
    ]);

    return {
      database: dbStats,
      schema: {
        tables: schema.tables.length,
        views: schema.views.length,
        functions: schema.functions.length,
      },
    };
  }

  /**
   * Register an event handler
   */
  on(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an event to all registered handlers
   */
  private emitEvent(event: NeuroBaseEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error({ error }, 'Event handler error');
      }
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.db.close();
    logger.info('NeuroBase closed');
  }

  /**
   * Get the database connection (for advanced usage)
   */
  getDatabase(): DatabaseConnection {
    return this.db;
  }

  /**
   * Get the schema introspector (for advanced usage)
   */
  getSchemaIntrospector(): SchemaIntrospector {
    return this.schema;
  }

  /**
   * Refresh the schema cache
   */
  async refreshSchema(): Promise<void> {
    this.schema.clearCache();
    await this.schema.getSchema();
    logger.info('Schema cache refreshed');
  }
}
