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
import { OperationSupervisor, type PermissionLevel } from '../orchestrator/supervisor';
import { ResultVerifier } from '../rag/result-verifier';
import { AuditLogger, type AuditAction } from '../security/audit-log';
import { IntentClassifier, type IntentResult } from '../agents/intent-classifier';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { join } from 'path';
import { randomUUID } from 'crypto';

/** Map a generated SQL statement to the audit log's coarse action category. */
function classifyAction(sql: string): AuditAction {
  const head = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  if (head === 'SELECT' || head === 'WITH' || head === 'EXPLAIN') return 'query';
  if (head === 'INSERT') return 'insert';
  if (head === 'UPDATE') return 'update';
  if (head === 'DELETE' || head === 'TRUNCATE') return 'delete';
  if (head === 'CREATE' || head === 'ALTER' || head === 'DROP' || head === 'RENAME') return 'schema_change';
  return 'admin';
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
  private supervisor: OperationSupervisor;
  private resultVerifier: ResultVerifier;
  private auditLogger: AuditLogger;
  private intentClassifier: IntentClassifier;

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

    // Initialize agents.
    //
    // Linguistic agent receives the privacy mode so its inner ValueExplorer
    // is gated correctly: strict / schema-only must NOT query the database
    // for distinct values to inject into the LLM prompt. Without this call,
    // the explorer ran regardless of the configured privacy mode — defeating
    // the strict-mode guarantee at the prompt boundary.
    this.linguisticAgent = new LinguisticAgent(this.llm, this.db);
    this.linguisticAgent.setPrivacyMode(config.security.privacyMode || 'schema-only');
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
    this.supervisor = new OperationSupervisor();
    this.resultVerifier = new ResultVerifier(this.db);
    this.auditLogger = new AuditLogger(this.db);
    this.intentClassifier = new IntentClassifier(this.llm);

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

    // Initialize the audit log table (engine-portable: PG / MySQL / SQLite).
    // Failures are non-fatal — recorded in debug and audit becomes a no-op.
    try {
      await this.auditLogger.initialize();
    } catch (err) {
      logger.debug({ err }, 'Audit log init failed — continuing without audit');
    }

    // Initialize memory storage. Portable across PostgreSQL (pgvector fast
    // path), MySQL and SQLite (TEXT-encoded embeddings, in-process cosine
    // similarity). MongoDB is no-op'd at the MemoryAgent level with a warn.
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
      // Step 0 — head agent: classify the intent and short-circuit when
      // the answer doesn't require the full NL→SQL pipeline. Rule-based
      // fast path handles greetings and obvious metadata requests at
      // zero LLM cost; ambiguous inputs fall through to the full flow.
      const intent: IntentResult = await this.intentClassifier.classify(nlQuery.text);
      logger.debug({ intent: intent.type, source: intent.source, conf: intent.confidence }, 'Intent classified');

      if (intent.type === 'conversational' && intent.suggestedPath.conversationalResponse) {
        return {
          data: [],
          sql: '',
          executionTime: Date.now() - startTime,
          rowCount: 0,
          explanation: intent.suggestedPath.conversationalResponse,
        };
      }

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

      // Step 1.5: Multi-candidate selection for complex queries (Tier 3/4).
      // Skipped when the head agent flagged the query as simple/metadata to
      // save LLM calls on cases that don't benefit from multiple candidates.
      if (
        this.config.features.enableMultiCandidate &&
        linguisticResult.confidence < 0.8 &&
        !intent.suggestedPath.skipMultiCandidate
      ) {
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

      // Step 2: Optimize query if enabled. Skipped when the head agent
      // flagged the query as trivial (metadata / simple SELECT).
      if (this.config.features.enableOptimization && !intent.suggestedPath.skipOptimizer) {
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

      // Permission enforcement — gate the SQL against the configured ladder
      // BEFORE we hand it to the driver. read-only / write / ddl / admin.
      //
      // `readonlyMode` is the legacy kill-switch and ALWAYS wins: setting
      // READONLY_MODE=true must lock the session to read-only even if
      // permissionLevel was relaxed elsewhere. Falling back to 'write' when
      // no level is configured matches the historical behaviour.
      const permissionLevel: PermissionLevel = this.config.security.readonlyMode
        ? 'read-only'
        : ((this.config.security.permissionLevel as PermissionLevel) ?? 'write');
      const enforcement = this.supervisor.enforce(finalSQL, permissionLevel);
      if (!enforcement.allowed) {
        logger.warn({
          level: enforcement.level,
          risk: enforcement.riskLevel,
          reason: enforcement.reason,
          sql: finalSQL.substring(0, 120),
        }, 'Operation denied by permission ladder');
        throw new Error(
          `Operation denied (permission: ${enforcement.level}). ${enforcement.reason}`,
        );
      }

      // Pre-execution sanity check — catches LLM-hallucinated table/column
      // references before they hit the driver. quickVerify is pure AST + schema
      // lookup, no LLM cost. If it surfaces a critical issue we abort; warnings
      // are kept for the response payload but don't block.
      try {
        const verify = this.resultVerifier.quickVerify(finalSQL, dbSchema);
        if (!verify.valid && verify.issues.some((i) => i.startsWith('[critical]'))) {
          throw new Error(
            `Pre-execution verification failed: ${verify.issues.join('; ')}`,
          );
        }
      } catch (verifyErr) {
        // Re-throw critical verification errors only; non-critical issues
        // should never bubble up — they're logged and execution continues.
        if (verifyErr instanceof Error && /verification failed/i.test(verifyErr.message)) {
          throw verifyErr;
        }
        logger.debug({ err: verifyErr }, 'Result verifier internal error, skipping pre-check');
      }

      try {
        result = await this.db.query(finalSQL, undefined, {
          timeout: this.config.security.maxQueryTime
        });
      } catch (execError) {
        // Self-correction loop
        if (this.config.features.enableSelfCorrection) {
          // Executor used for EACH attempt inside the correction loop. We
          // enforce the permission ladder on every retry — without this, a
          // mid-loop LLM hallucination that produces a destructive query
          // would execute before the final ladder check below.
          const enforcedExecutor = async (sql: string) => {
            const attemptEnforce = this.supervisor.enforce(sql, permissionLevel);
            if (!attemptEnforce.allowed) {
              throw new Error(
                `Correction attempt denied by permission ladder: ${attemptEnforce.reason}`,
              );
            }
            return this.db.query(sql, undefined, { timeout: this.config.security.maxQueryTime });
          };

          const correction = await this.selfCorrectionLoop.correctWithExecution(
            nlQuery.text,
            finalSQL,
            execError instanceof Error ? execError.message : String(execError),
            dbSchema,
            enforcedExecutor,
          );

          if (correction.success) {
            finalSQL = correction.finalSQL;
            corrected = true;
            correctionAttempts = correction.attempts;

            // Belt-and-suspenders: re-check the final SQL after the loop.
            // Already validated by enforcedExecutor on the successful pass,
            // but cheap and protects against future executor signature drift.
            const reEnforce = this.supervisor.enforce(finalSQL, permissionLevel);
            if (!reEnforce.allowed) {
              throw new Error(
                `Self-correction produced a denied operation (permission: ${reEnforce.level}). ${reEnforce.reason}`,
              );
            }

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

      // Step 3.5: Append to the immutable audit log. Fire-and-forget — we
      // never block the query response on the audit write, but every
      // successfully-executed query leaves a row behind.
      const action = classifyAction(finalSQL);
      this.auditLogger.log({
        userId: nlQuery.userId,
        action,
        sqlHash: createHash('sha256').update(finalSQL).digest('hex'),
        sql: finalSQL,
        resultRows: result.rowCount || 0,
        executionTimeMs: executionTime,
        severity: action === 'admin' || action === 'schema_change' ? 'warning' : 'info',
        metadata: { corrected, permissionLevel },
      }).catch((err) => logger.debug({ err }, 'Audit write failed (non-fatal)'));

      // Step 4: Learn from this interaction
      if (this.config.features.enableLearning) {
        await this.memoryAgent.process({
          action: 'store',
          entry: {
            id: randomUUID(),
            naturalLanguage: nlQuery.text,
            sql: finalSQL,
            userId: nlQuery.userId,
            timestamp: new Date(),
            success: true,
            corrected,
          },
        });
      }

      // Step 5: Post-execution explanation — skipped when the head agent
      // judged the query trivial (e.g. schema introspection results don't
      // benefit from a NL explanation).
      let explanation = linguisticResult.explanation;
      if (nlQuery.context?.userPreferences?.includeExplanation && !intent.suggestedPath.skipExplainer) {
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
        logger.error({ err: error }, 'Event handler error');
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

  /** Current LLM model identifier. */
  getLLMModel(): string {
    return this.llm.getModel();
  }

  /** Switch the LLM model for subsequent calls in this session. */
  setLLMModel(model: string): void {
    this.llm.setModel(model);
    logger.debug({ model }, 'LLM model switched');
  }

  /** Active LLM provider name. */
  getLLMProvider(): string {
    return this.config.llm.provider;
  }

  /**
   * Swap the active database at runtime. Disconnects the current adapter,
   * creates a fresh one from the new config, and recreates every agent that
   * holds a reference to the database. The LLM provider is preserved.
   *
   * Used by the REPL `/db switch <name>` command so users don't have to
   * restart the session to switch between registered databases.
   */
  async switchDatabase(newDbConfig: Config['database']): Promise<void> {
    logger.debug({ engine: newDbConfig.engine }, 'Switching database');

    // Drop the existing pool / connection.
    try { await this.db.disconnect(); } catch { /* best effort */ }

    // Mutate config in place so getDatabase() / getStats() reflect the new state.
    this.config = { ...this.config, database: newDbConfig };

    // Rebuild the adapter + every agent that captured the old reference.
    this.db = AdapterFactory.create(newDbConfig);
    await this.db.connect();
    const ok = await this.db.testConnection();
    if (!ok) throw new Error('Failed to connect to the new database');

    this.schema = new SchemaIntrospector(this.db);
    this.linguisticAgent = new LinguisticAgent(this.llm, this.db);
    this.linguisticAgent.setPrivacyMode(this.config.security.privacyMode || 'schema-only');
    this.optimizerAgent = new OptimizerAgent(this.db, this.llm);
    this.memoryAgent = new MemoryAgent(this.db, this.llm);
    this.candidateSelector = new CandidateSelector(this.llm, this.db);
    this.diagnosticSearch = new DiagnosticTreeSearch(this.db);
    this.resultVerifier = new ResultVerifier(this.db);
    this.auditLogger = new AuditLogger(this.db);
    await this.auditLogger.initialize().catch((err) =>
      logger.debug({ err }, 'Audit log init failed during switch — continuing without'),
    );
    this.semanticCatalog = new SemanticCatalogGenerator(
      this.db, this.llm, this.config.security.privacyMode || 'schema-only',
    );

    // Memory storage initialises itself across engines (PG fast path,
    // MySQL/SQLite portable path, Mongo no-op with warn).
    if (this.config.features.enableLearning) {
      await this.memoryAgent.initializeStorage();
    }
    // Re-introspect in the background — don't block the caller on it.
    this.schema.getSchema().then((schema) =>
      this.semanticCatalog.initialize(schema).catch(() => { /* best effort */ }),
    ).catch(() => { /* best effort */ });

    logger.debug({ engine: newDbConfig.engine }, 'Database switched');
  }
}
