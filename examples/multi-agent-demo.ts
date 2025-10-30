/**
 * Multi-Agent System Demo
 * Demonstrates how to use NeuroBase's multi-agent capabilities
 */

import { MultiAgentOrchestrator } from '../src/orchestrator/multi-agent-orchestrator';
import { ForkSynchronizer } from '../src/orchestrator/fork-synchronizer';
import { SchemaEvolutionAgent } from '../src/agents/schema-evolution';
import { QueryValidatorAgent } from '../src/agents/query-validator';
import { LearningAggregatorAgent } from '../src/agents/learning-aggregator';
import { DatabaseForkManager } from '../src/database/fork';
import { OpenAIProvider } from '../src/llm/providers/openai';
import { AnthropicProvider } from '../src/llm/providers/anthropic';
import { OllamaProvider } from '../src/llm/providers/ollama';
import { config } from '../src/config';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function multiAgentDemo() {
  console.log('🚀 NeuroBase Multi-Agent System Demo\n');

  // Initialize main pool
  const mainPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
  });

  // Initialize orchestrator
  const orchestrator = new MultiAgentOrchestrator(process.env.DATABASE_URL!);
  await orchestrator.initialize();

  console.log('✅ Orchestrator initialized\n');

  // Initialize synchronizer
  const synchronizer = new ForkSynchronizer(mainPool);

  console.log('✅ Synchronizer initialized\n');

  // ========================================================================
  // 1. REGISTER SCHEMA EVOLUTION AGENT
  // ========================================================================

  console.log('📝 Registering Schema Evolution Agent...');

  const schemaAgent = await orchestrator.registerAgent({
    name: 'Schema Evolution Agent',
    type: 'schema-evolution',
    enabled: true,
    forkStrategy: 'now',
    autoStart: true,
  });

  console.log(`✅ Schema Agent registered: ${schemaAgent.id}\n`);

  // Wait for agent to start and fork to be created
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Get agent details
  const schemaAgentDetails = orchestrator.getAgent(schemaAgent.id);
  console.log(`   Fork ID: ${schemaAgentDetails?.fork?.id}`);
  console.log(`   Status: ${schemaAgentDetails?.status}\n`);

  // ========================================================================
  // 2. REGISTER QUERY VALIDATOR AGENT
  // ========================================================================

  console.log('📝 Registering Query Validator Agent...');

  const validatorAgent = await orchestrator.registerAgent({
    name: 'Query Validator Agent',
    type: 'query-validator',
    enabled: true,
    forkStrategy: 'last-snapshot',
    autoStart: true,
  });

  console.log(`✅ Validator Agent registered: ${validatorAgent.id}\n`);

  await new Promise(resolve => setTimeout(resolve, 3000));

  // ========================================================================
  // 3. REGISTER LEARNING AGGREGATOR AGENT
  // ========================================================================

  console.log('📝 Registering Learning Aggregator Agent...');

  const learningAgent = await orchestrator.registerAgent({
    name: 'Learning Aggregator Agent',
    type: 'learning-aggregator',
    enabled: true,
    forkStrategy: 'now',
    autoStart: true,
  });

  console.log(`✅ Learning Agent registered: ${learningAgent.id}\n`);

  await new Promise(resolve => setTimeout(resolve, 3000));

  // ========================================================================
  // 4. DEMONSTRATE SCHEMA EVOLUTION
  // ========================================================================

  console.log('🔧 Testing Schema Evolution Agent...');

  // Get agent's pool
  const schemaAgentPool = schemaAgentDetails?.pool;

  if (schemaAgentPool) {
    // Initialize LLM provider based on config
    let llmProvider;
    if (config.llm.provider === 'openai' && config.llm.openai) {
      llmProvider = new OpenAIProvider(config.llm.openai);
    } else if (config.llm.provider === 'anthropic' && config.llm.anthropic) {
      llmProvider = new AnthropicProvider(config.llm.anthropic);
    } else if (config.llm.ollama) {
      llmProvider = new OllamaProvider(config.llm.ollama);
    } else {
      console.log('⚠️  No LLM provider configured, skipping schema evolution demo');
      llmProvider = null;
    }

    if (!llmProvider) {
      console.log('   Skipped: Schema Evolution Agent (no LLM provider)\n');
    } else {
      const schemaEvolutionAgent = new SchemaEvolutionAgent(schemaAgentPool, llmProvider);

    console.log('   Analyzing schema and query patterns...');

      const analysis = await schemaEvolutionAgent.analyzeAndRecommend();

      console.log(`   Found ${analysis.recommendations.length} recommendations:`);

      for (const rec of analysis.recommendations.slice(0, 3)) {
        console.log(`   - ${rec.type}: ${rec.description}`);
        console.log(`     Impact: ${rec.estimatedImpact.querySpeedup}% speedup`);
        console.log(`     Priority: ${rec.priority}\n`);
      }
    }
  }

  // ========================================================================
  // 5. DEMONSTRATE QUERY VALIDATION
  // ========================================================================

  console.log('✅ Testing Query Validator Agent...');

  const validatorAgentDetails = orchestrator.getAgent(validatorAgent.id);
  const validatorPool = validatorAgentDetails?.pool;

  if (validatorPool) {
    const queryValidator = new QueryValidatorAgent(validatorPool);

    const testQueries = [
      'SELECT * FROM users WHERE id = 1',
      'DELETE FROM users', // Dangerous!
      'SELECT name, email FROM users LIMIT 10',
    ];

    for (const query of testQueries) {
      console.log(`\n   Testing: ${query}`);
      const validation = await queryValidator.validateQuery(query);

      console.log(`   Valid: ${validation.isValid}`);
      console.log(`   Safe: ${validation.isSafe}`);

      if (validation.warnings.length > 0) {
        console.log(`   Warnings: ${validation.warnings.join(', ')}`);
      }

      if (validation.errors.length > 0) {
        console.log(`   Errors: ${validation.errors.join(', ')}`);
      }
    }

    console.log();
  }

  // ========================================================================
  // 6. DEMONSTRATE FORK SYNCHRONIZATION
  // ========================================================================

  console.log('🔄 Testing Fork Synchronization...');

  // Register forks with synchronizer
  if (schemaAgentDetails?.fork && validatorAgentDetails?.fork) {
    const schemaForkId = schemaAgentDetails.fork.id;
    const validatorForkId = validatorAgentDetails.fork.id;

    const schemaConnectionString = await new DatabaseForkManager().getForkConnectionString(
      schemaForkId
    );
    const validatorConnectionString = await new DatabaseForkManager().getForkConnectionString(
      validatorForkId
    );

    synchronizer.registerFork(schemaForkId, schemaConnectionString);
    synchronizer.registerFork(validatorForkId, validatorConnectionString);

    console.log('   Creating sync job...');

    const syncJob = await synchronizer.createSyncJob({
      source: schemaForkId,
      target: validatorForkId,
      tables: ['neurobase_learning_history'],
      mode: 'incremental',
      direction: 'push',
      conflictResolution: 'source-wins',
    });

    console.log(`   Sync job created: ${syncJob.id}`);
    console.log(`   Executing sync...`);

    await synchronizer.executeSync(syncJob.id);

    console.log(`   ✅ Synced ${syncJob.recordsSynced} records\n`);
  }

  // ========================================================================
  // 7. DEMONSTRATE LEARNING AGGREGATION
  // ========================================================================

  console.log('🧠 Testing Learning Aggregator Agent...');

  const learningAgentDetails = orchestrator.getAgent(learningAgent.id);
  const learningPool = learningAgentDetails?.pool;

  if (learningPool) {
    const learningAggregator = new LearningAggregatorAgent(learningPool);

    console.log('   Aggregating learning data...');

    const insights = await learningAggregator.aggregateAndSynthesize();

    console.log(`   Found ${insights.length} insights:`);

    for (const insight of insights.slice(0, 3)) {
      console.log(`   - Type: ${insight.type}`);
      console.log(`     Description: ${insight.description}`);
      console.log(`     Impact: ${insight.impact}`);
      console.log(`     Confidence: ${(insight.confidence * 100).toFixed(0)}%\n`);
    }
  }

  // ========================================================================
  // 8. DEMONSTRATE AGENT COMMUNICATION
  // ========================================================================

  console.log('💬 Testing Agent Communication...');

  // Send message from schema agent to validator agent
  await orchestrator.sendMessage(
    schemaAgent.id,
    validatorAgent.id,
    'recommendation',
    {
      type: 'index',
      table: 'users',
      column: 'email',
      reason: 'Frequent searches on email column',
    }
  );

  console.log('   Message sent from Schema Agent to Validator Agent');

  // Get messages for validator agent
  const messages = await orchestrator.getMessages(validatorAgent.id, true);

  console.log(`   Validator Agent has ${messages.length} unread messages\n`);

  // ========================================================================
  // 9. SHOW STATISTICS
  // ========================================================================

  console.log('📊 System Statistics:');

  const stats = await orchestrator.getStatistics();

  console.log(`   Total Agents: ${stats.totalAgents}`);
  console.log(`   Running Agents: ${stats.runningAgents}`);
  console.log(`   Total Tasks: ${stats.totalTasksProcessed}`);
  console.log(`   Pending Tasks: ${stats.pendingTasks}`);
  console.log(`   Error Rate: ${((stats.totalErrors / stats.totalTasksProcessed) * 100).toFixed(1)}%\n`);

  // Recent events
  const events = orchestrator.getEventHistory(5);

  console.log('   Recent Events:');
  for (const event of events) {
    console.log(`   - ${event.type} at ${event.timestamp.toLocaleTimeString()}`);
  }

  console.log();

  // ========================================================================
  // 10. CLEANUP
  // ========================================================================

  console.log('🧹 Cleaning up...');

  // Stop agents (but don't delete forks)
  await orchestrator.stopAgent(schemaAgent.id, false);
  await orchestrator.stopAgent(validatorAgent.id, false);
  await orchestrator.stopAgent(learningAgent.id, false);

  console.log('   Agents stopped');

  // Shutdown
  await orchestrator.shutdown();
  await synchronizer.shutdown();
  await mainPool.end();

  console.log('✅ Demo completed successfully!\n');

  console.log('💡 Next Steps:');
  console.log('   1. Run the Multi-Agent API: npm run serve:multi-agent');
  console.log('   2. Open dashboard: http://localhost:3000/dashboard');
  console.log('   3. Read guide: MULTI_AGENT_GUIDE.md\n');
}

// Run demo
if (require.main === module) {
  multiAgentDemo()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Demo failed:', error);
      process.exit(1);
    });
}

export { multiAgentDemo };
