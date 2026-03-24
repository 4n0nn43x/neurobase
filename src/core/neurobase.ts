/**
 * NeuroBase Core - Main orchestrator for the intelligent database system
 */

import { Config, NaturalLanguageQuery, QueryResult, EventHandler, NeuroBaseEvent, DiagnosticResult, SemanticModel } from '../types';
import { DatabaseAdapter } from '../database/adapter';
import { AdapterFactory } from '../database/adapter-factory';
import { SchemaIntrospector } from '../database/schema';
import { LLMFactory, BaseLLMProvider } from '../llm';
import { LinguisticAgent } from '../agents/linguistic';
import { OptimizerAgent } from '../agents/optimizer';
import { MemoryAgent } from '../agents/memory';
import { QueryExplainerAgent } from '../agents/explainer';
import { SelfCorrectionLoop } from '../rag/self-correction';
import { CandidateSelector } from '../rag/candidate-selector';
import { DiagnosticTreeSearch } from '../diagnostics/tree-search';
import { SemanticCatalogGenerator } from '../semantic/auto-catalog';
import { SemanticLoader } from '../semantic/loader';
import { SemanticRenderer } from '../semantic/renderer';
import { PrivacyGuard } from '../security/privacy-guard';
import { logger } from '../utils/logger';
import { join } from 'path';

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class NeuroBase {
  private config: Config;
  private db: DatabaseAdapter;
  private schema: SchemaIntrospector;
  private llm: BaseLLMProvider;
  private linguisticAgent: LinguisticAgent;
  private optimizerAgent: OptimizerAgent;
  private memoryAgent: MemoryAgent;
  private eventHandlers: EventHandler[] = [];

  // v3 components
  private selfCorrectionLoop: SelfCorrectionLoop;
  private candidateSelector: CandidateSelector;
  private diagnosticSearch: DiagnosticTreeSearch;
  private explainerAgent: QueryExplainerAgent;
  private privacyGuard: PrivacyGuard;
  private semanticCatalog: SemanticCatalogGenerator;
  private semanticModel: SemanticModel | null = null;

  constructor(config: Config) {
    this.config = config;

    // Initialize database adapter
    this.db = AdapterFactory.create(config.database);

    // Initialize schema introspector
    this.schema = new SchemaIntrospector(this.db);

    // Initialize LLM provider
    this.llm = LLMFactory.create(config.llm);

    // Initialize privacy guard
    this.privacyGuard = new PrivacyGuard(config.security.privacyMode || 'schema-only');

    // Initialize agents
    this.linguisticAgent = new LinguisticAgent(this.llm, this.db);
    this.optimizerAgent = new OptimizerAgent(this.db, this.llm);
    this.memoryAgent = new MemoryAgent(this.db, this.llm);
    this.explainerAgent = new QueryExplainerAgent(this.llm, this.privacyGuard.canSendRowData());

    // v3 components
    this.selfCorrectionLoop = new SelfCorrectionLoop(this.llm);
    this.candidateSelector = new CandidateSelector(this.llm, this.db);
    this.diagnosticSearch = new DiagnosticTreeSearch(this.db);
    this.semanticCatalog = new SemanticCatalogGenerator(
      this.db, this.llm, config.security.privacyMode || 'schema-only'
    );

    // Load semantic model if available
    try {
      this.semanticModel = SemanticLoader.load(join(process.cwd(), 'neurobase.semantic.yml'));
      if (this.semanticModel) {
        this.linguisticAgent.setSemanticContext(SemanticRenderer.render(this.semanticModel));
      }
    } catch {
      // No semantic model — retrocompatible
    }

    logger.debug({
      mode: config.neurobase.mode,
      llmProvider: config.llm.provider,
      dbEngine: config.database.engine,
    }, 'NeuroBase initialized');
  }

  /**
   * Initialize NeuroBase (test connection, setup tables, etc.)
   */
  async initialize(): Promise<void> {
    logger.debug('Starting NeuroBase initialization');

    // Connect and test database
    await this.db.connect();
    const connected = await this.db.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize memory storage tables
    if (this.config.features.enableLearning) {
      await this.memoryAgent.initializeStorage();
    }

    // Introspect schema
    const dbSchema = await this.schema.getSchema();

    // Start semantic catalog generation in background (non-blocking)
    this.semanticCatalog.initialize(dbSchema).catch(err => {
      logger.debug({ err }, 'Semantic catalog background init failed');
    });

    logger.debug('NeuroBase initialization complete');
  }

  /**
   * Process a natural language query
   */
  async query(query: string | NaturalLanguageQuery): Promise<QueryResult> {
    const nlQuery: NaturalLanguageQuery =
      typeof query === 'string' ? { text: query } : query;

    const startTime = Date.now();

    logger.debug({
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
      let dbSchema = await this.schema.getSchema();

      // Enrich schema with semantic catalog descriptions
      dbSchema = this.semanticCatalog.enrichSchema(dbSchema);

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
        logger.debug({
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

      // Step 1.5: Multi-candidate selection for complex queries (Tier 3/4)
      if (this.config.features.enableMultiCandidate && linguisticResult.confidence < 0.8) {
        try {
          const selection = await this.candidateSelector.select(
            nlQuery.text, '', '', dbSchema,
            async (temp: number) => {
              const result = await this.linguisticAgent.generateWithTemperature(
                nlQuery.text, dbSchema, learningHistory, temp
              );
              return result;
            },
            3
          );
          if (selection.bestSQL) {
            finalSQL = selection.bestSQL;
            logger.debug({ method: selection.selectionMethod }, 'Multi-candidate selection applied');
          }
        } catch (err) {
          logger.debug({ err }, 'Multi-candidate selection failed, using original');
        }
      }

      // Step 2: Optimize query if enabled
      if (this.config.features.enableOptimization) {
        const optimizerResult = await this.optimizerAgent.process({
          sql: finalSQL,
          schema: dbSchema,
        });

        if (optimizerResult.applied) {
          finalSQL = optimizerResult.optimizedSQL;
          logger.debug({
            originalSQL: linguisticResult.sql.substring(0, 50),
            optimizedSQL: finalSQL.substring(0, 50),
          }, 'Query optimized');
        }
      }

      // Step 3: Execute query (with self-correction on failure)
      let result: { rows: any[]; rowCount: number | null };
      let corrected = false;
      let correctionAttempts: any[] | undefined;

      try {
        result = await this.db.query(finalSQL, undefined, {
          timeout: this.config.security.maxQueryTime
        });
      } catch (execError) {
        // Self-correction loop
        if (this.config.features.enableSelfCorrection) {
          const correction = await this.selfCorrectionLoop.correctWithExecution(
            nlQuery.text,
            finalSQL,
            execError instanceof Error ? execError.message : String(execError),
            dbSchema,
            async (sql) => this.db.query(sql, undefined, { timeout: this.config.security.maxQueryTime })
          );

          if (correction.success) {
            finalSQL = correction.finalSQL;
            corrected = true;
            correctionAttempts = correction.attempts;
            result = await this.db.query(finalSQL, undefined, {
              timeout: this.config.security.maxQueryTime
            });
          } else {
            throw execError; // All correction attempts failed
          }
        } else {
          throw execError;
        }
      }

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
            corrected,
          },
        });
      }

      // Step 5: Post-execution explanation
      let explanation = linguisticResult.explanation;
      if (nlQuery.context?.userPreferences?.includeExplanation) {
        try {
          explanation = await this.explainerAgent.explain({
            originalQuery: nlQuery.text,
            sql: finalSQL,
            rowCount: result.rowCount || 0,
            columns: result.rows.length > 0 ? Object.keys(result.rows[0]) : undefined,
            sampleRows: this.privacyGuard.canSendRowData() ? result.rows.slice(0, 3) : undefined,
          });
        } catch {
          // Keep original explanation on failure
        }
      }

      const queryResult: QueryResult = {
        data: result.rows,
        sql: finalSQL,
        executionTime,
        rowCount: result.rowCount || 0,
        explanation,
        learned: this.config.features.enableLearning,
        corrected,
        correctionAttempts,
      };

      this.emitEvent({
        type: 'query:complete',
        payload: queryResult,
      });

      logger.debug({
        rowCount: queryResult.rowCount,
        executionTime,
        corrected,
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

    logger.debug({
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
   * Diagnose performance issues with a SQL query
   */
  async diagnose(sql: string): Promise<DiagnosticResult> {
    return this.diagnosticSearch.diagnose(sql);
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.db.disconnect();
    logger.debug('NeuroBase closed');
  }

  /**
   * Get the database adapter (for advanced usage)
   */
  getDatabase(): DatabaseAdapter {
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
    logger.debug('Schema cache refreshed');
  }
}
