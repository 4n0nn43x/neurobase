/**
 * Core type definitions for NeuroBase
 */

import { DatabaseConfig } from '../database/adapter';

export interface Config {
  database: DatabaseConfig;
  llm: LLMConfig;
  neurobase: NeuroBaseConfig;
  features: FeatureFlags;
  security: SecurityConfig;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama';
  openai?: OpenAIConfig;
  anthropic?: AnthropicConfig;
  ollama?: OllamaConfig;
}

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  temperature: number;
}

export interface NeuroBaseConfig {
  mode: 'interactive' | 'api' | 'readonly';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  port: number;
}

export interface FeatureFlags {
  enableLearning: boolean;
  enableOptimization: boolean;
  enableSchemaSuggestions: boolean;
  enableQueryCache: boolean;
  enableSelfCorrection: boolean;
  enableMultiCandidate: boolean;
}

export interface SecurityConfig {
  apiRateLimit: number;
  readonlyMode: boolean;
  maxQueryTime: number;
  privacyMode?: 'strict' | 'schema-only' | 'permissive';
}

// Query Types
export interface NaturalLanguageQuery {
  text: string;
  userId?: string;
  conversationId?: string;
  context?: QueryContext;
}

export interface QueryContext {
  previousQueries: string[];
  schemaHints?: string[];
  userPreferences?: Record<string, any>;
  conversationContext?: string;
}

export interface SQLQuery {
  sql: string;
  parameters?: any[];
  estimatedCost?: number;
}

export interface QueryResult {
  data: any[];
  sql: string;
  executionTime: number;
  rowCount: number;
  explanation?: string;
  suggestions?: string[];
  learned?: boolean;
  corrected?: boolean;
  correctionAttempts?: CorrectionAttempt[];
}

// Self-correction types (Phase 1A)
export interface CorrectionAttempt {
  attempt: number;
  sql: string;
  error: string;
  temperature: number;
}

export interface SelfCorrectionResult {
  success: boolean;
  finalSQL: string;
  attempts: CorrectionAttempt[];
  originalError: string;
}

// Semantic model types (Phase 2B)
export interface SemanticModel {
  entities: SemanticEntity[];
  version?: string;
}

export interface SemanticEntity {
  name: string;
  table: string;
  description?: string;
  metrics?: SemanticMetric[];
  relationships?: SemanticRelationship[];
}

export interface SemanticMetric {
  name: string;
  expression: string;
  description?: string;
}

export interface SemanticRelationship {
  target: string;
  type: 'one_to_one' | 'one_to_many' | 'many_to_many';
  join: string;
}

// Diagnostic types (Phase 4A)
export interface DiagnosticNode {
  id: string;
  name: string;
  query: string;
  condition: (result: any) => boolean;
  children?: DiagnosticNode[];
  recommendation?: string;
}

export interface DiagnosticResult {
  rootCause: string;
  path: string[];
  recommendations: string[];
  details: Record<string, any>;
}

export interface QueryAnalysis {
  sql: string;
  executionPlan: ExecutionPlan;
  suggestions: OptimizationSuggestion[];
  performance: PerformanceMetrics;
}

export interface ExecutionPlan {
  plan: any;
  totalCost: number;
  estimatedRows: number;
  actualTime?: number;
}

export interface OptimizationSuggestion {
  type: 'index' | 'rewrite' | 'cache' | 'partition';
  description: string;
  impact: 'high' | 'medium' | 'low';
  sql?: string;
  autoApply: boolean;
}

export interface PerformanceMetrics {
  executionTime: number;
  planningTime: number;
  rowsReturned: number;
  buffersHit: number;
  buffersMissed: number;
}

// Learning Types
export interface LearningEntry {
  id: string;
  naturalLanguage: string;
  sql: string;
  userId?: string;
  timestamp: Date;
  success: boolean;
  corrected: boolean;
  embedding?: number[];
  context?: Record<string, any>;
}

export interface Correction {
  originalQuery: string;
  originalSQL: string;
  correctedSQL: string;
  correctedQuery?: string;
  reason: string;
  userId?: string;
  timestamp: Date;
}

// Schema Types
export interface DatabaseSchema {
  tables: TableSchema[];
  views: ViewSchema[];
  functions: FunctionSchema[];
}

export interface TableSchema {
  name: string;
  schema: string;
  columns: ColumnSchema[];
  primaryKeys: string[];
  foreignKeys: ForeignKeySchema[];
  indexes: IndexSchema[];
  rowCount?: number;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  description?: string;
}

export interface ForeignKeySchema {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface IndexSchema {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
}

export interface ViewSchema {
  name: string;
  schema: string;
  definition: string;
}

export interface FunctionSchema {
  name: string;
  schema: string;
  returnType: string;
  parameters: ParameterSchema[];
}

export interface ParameterSchema {
  name: string;
  type: string;
  default?: string;
}

// Agent Types
export interface Agent {
  name: string;
  process(input: any): Promise<any>;
}

export interface LinguisticAgentInput {
  query: NaturalLanguageQuery;
  schema: DatabaseSchema;
  learningHistory?: LearningEntry[];
}

export interface MissingColumnInfo {
  column: string;
  type: string;
  description?: string;
  defaultValue?: string;
  possibleValues?: string[];
}

export interface LinguisticAgentOutput {
  sql: string;
  confidence: number;
  explanation: string;
  clarificationNeeded?: string;
  alternatives?: string[];
  missingData?: {
    table: string;
    columns: MissingColumnInfo[];
    reason: string;
  };
  needsClarification?: boolean;
  clarificationQuestion?: string;
  suggestedInterpretations?: Array<{
    description: string;
    sql: string;
  }>;
  isConversational?: boolean;
  conversationalResponse?: string;
}

export interface OptimizerAgentInput {
  sql: string;
  schema: DatabaseSchema;
  historical?: QueryAnalysis[];
}

export interface OptimizerAgentOutput {
  optimizedSQL: string;
  analysis: QueryAnalysis;
  applied: boolean;
}

export interface MemoryAgentInput {
  entry: LearningEntry;
  action: 'store' | 'retrieve' | 'update';
  query?: string;
}

export interface MemoryAgentOutput {
  success: boolean;
  relevantEntries?: LearningEntry[];
  similarQueries?: LearningEntry[];
}

// API Types
export interface APIQueryRequest {
  query: string;
  userId?: string;
  conversationId?: string;
  includeExplanation?: boolean;
  includeSuggestions?: boolean;
  dryRun?: boolean;
}

export interface APIQueryResponse {
  success: boolean;
  data?: any[];
  sql?: string;
  executionTime?: number;
  rowCount?: number;
  explanation?: string;
  suggestions?: string[];
  error?: string;
}

export interface APISchemaResponse {
  success: boolean;
  schema?: DatabaseSchema;
  error?: string;
}

// Event Types
export type NeuroBaseEvent =
  | { type: 'query:start'; payload: { query: string } }
  | { type: 'query:complete'; payload: QueryResult }
  | { type: 'query:error'; payload: { error: Error } }
  | { type: 'learning:new'; payload: LearningEntry }
  | { type: 'optimization:applied'; payload: OptimizationSuggestion }
  | { type: 'schema:updated'; payload: DatabaseSchema };

export interface EventHandler {
  (event: NeuroBaseEvent): void | Promise<void>;
}
