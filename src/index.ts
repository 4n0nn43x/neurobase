/**
 * NeuroBase - Intelligent, self-learning conversational database
 *
 * Main entry point for the NeuroBase library
 */

export * from './core/neurobase';
export * from './config';
export * from './types';
export * from './database';
export * from './llm';

// Export agents separately to avoid naming conflicts
export {
  LinguisticAgent,
  OptimizerAgent,
  MemoryAgent,
  SchemaEvolutionAgent,
  QueryValidatorAgent,
  LearningAggregatorAgent,
  ABTestingAgent,
} from './agents';

// Re-export commonly used items
export { NeuroBase } from './core/neurobase';
export { loadConfig } from './config';
export { logger } from './utils/logger';
