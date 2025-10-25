/**
 * Core type definitions for NeuroBase
 */

export interface Config {
  tiger: TigerConfig;
  llm: LLMConfig;
  neurobase: NeuroBaseConfig;
  features: FeatureFlags;
  security: SecurityConfig;
}

export interface TigerConfig {
  serviceId: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
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
}

export interface SecurityConfig {
  apiRateLimit: number;
  readonlyMode: boolean;
  maxQueryTime: number;
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

export interface LinguisticAgentOutput {
  sql: string;
  confidence: number;
  explanation: string;
  clarificationNeeded?: string;
  alternatives?: string[];
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
