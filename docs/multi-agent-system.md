# Multi-Agent System

## Overview

NeuroBase's multi-agent system enables multiple specialized AI agents to work collaboratively on separate database forks, coordinated by a central orchestrator.

## Architecture

```
Multi-Agent Orchestrator (Main DB)
├── Agent Registry
├── Task Queue
├── Event System
└── Messaging

Specialized Agents (Each on Fork)
├── Schema Evolution Agent
├── Query Validator Agent
├── Learning Aggregator Agent
└── A/B Testing Agent

Fork Synchronizer
└── Knowledge Sharing
```

---

## Specialized Agents

### 1. Schema Evolution Agent

**Purpose:** Analyzes query patterns and proposes database optimizations.

**Capabilities:**
- Query pattern analysis
- Index recommendations
- Materialized view suggestions
- Partition strategies
- Performance impact testing

**Usage:**
```typescript
import { SchemaEvolutionAgent } from './agents/schema-evolution';

const agent = new SchemaEvolutionAgent(pool, llmProvider);

// Analyze and get recommendations
const analysis = await agent.analyzeAndRecommend();

for (const rec of analysis.recommendations) {
  // Test on fork
  const result = await agent.testRecommendation(rec);

  if (result.success && result.performanceGain > 30) {
    // Apply to production
    await agent.applyRecommendation(rec, mainPool);
  }
}
```

**Output Example:**
```json
{
  "type": "index",
  "priority": "high",
  "description": "Add index on users(email)",
  "sql": "CREATE INDEX idx_users_email ON users(email);",
  "estimatedImpact": {
    "querySpeedup": 65,
    "storageIncrease": 5,
    "maintenanceCost": "low"
  }
}
```

---

### 2. Query Validator Agent

**Purpose:** Validates queries before execution on production database.

**Capabilities:**
- Syntax validation
- Dangerous pattern detection
- Performance analysis
- Security checks
- Execution testing

**Dangerous Patterns Detected:**
- `DROP TABLE/DATABASE`
- `TRUNCATE TABLE`
- `DELETE` without `WHERE`
- `UPDATE` without `WHERE`
- `ALTER TABLE`

**Usage:**
```typescript
import { QueryValidatorAgent } from './agents/query-validator';

const validator = new QueryValidatorAgent(pool);

const validation = await validator.validateQuery(
  "SELECT * FROM users WHERE id = 1"
);

console.log(validation.isValid);    // true
console.log(validation.isSafe);     // true
console.log(validation.warnings);   // ["SELECT * detected"]
console.log(validation.performance); // { estimatedCost: 12.5 }
```

**Validation Output:**
```json
{
  "isValid": true,
  "isSafe": true,
  "warnings": ["SELECT * detected - consider specific columns"],
  "errors": [],
  "performance": {
    "estimatedCost": 12.5,
    "estimatedRows": 1,
    "executionTime": 25
  },
  "recommendations": [
    "Specify exact columns instead of SELECT *"
  ]
}
```

---

### 3. Learning Aggregator Agent

**Purpose:** Collects and synthesizes learning from all agents.

**Capabilities:**
- Cross-agent pattern detection
- Semantic clustering
- Knowledge graph construction
- Insight generation
- Learning synchronization

**Usage:**
```typescript
import { LearningAggregatorAgent } from './agents/learning-aggregator';

const aggregator = new LearningAggregatorAgent(pool);

// Aggregate learning
const insights = await aggregator.aggregateAndSynthesize();

// Get knowledge graph
const graph = await aggregator.getKnowledgeGraph();

// Filter insights
const actionable = await aggregator.getInsights({
  actionable: true,
  impact: 'high'
});
```

**Insight Types:**
- `pattern` - Common query patterns
- `optimization` - Performance opportunities
- `error` - Recurring failures
- `correction` - User corrections
- `cross-agent` - Multi-agent patterns

**Insight Example:**
```json
{
  "id": "insight-123",
  "type": "cross-agent",
  "description": "Pattern 'JOIN query' observed across 3 agents",
  "confidence": 0.92,
  "sources": ["agent-1", "agent-2", "agent-3"],
  "impact": "high",
  "actionable": true,
  "relatedQueries": [...]
}
```

---

### 4. A/B Testing Agent

**Purpose:** Tests multiple strategies in parallel using separate forks.

**Capabilities:**
- Parallel strategy testing
- Multiple fork creation
- Performance comparison
- Statistical analysis
- Winner determination

**Usage:**
```typescript
import { ABTestingAgent } from './agents/ab-testing';

const abTesting = new ABTestingAgent(mainPool, forkManager);

// Create experiment
const experiment = await abTesting.createExperiment(
  "SQL Generation Strategies",
  "Compare different LLM approaches",
  [
    {
      id: "gpt4",
      name: "GPT-4 with examples",
      type: "sql-generation",
      config: { model: "gpt-4" }
    },
    {
      id: "claude",
      name: "Claude with schema",
      type: "sql-generation",
      config: { model: "claude" }
    }
  ]
);

// Start and run
await abTesting.startExperiment(experiment.id);
await abTesting.runTest(experiment.id, testQueries);

// Analyze results
const results = await abTesting.analyzeResults(experiment.id);

console.log(`Winner: ${results.winner}`);
console.log(`Recommendation: ${results.recommendation}`);
```

**Metrics Compared:**
- Success rate
- Average response time
- Query cost
- Error rate

---

## Multi-Agent Orchestrator

**Purpose:** Central coordinator for all agents.

### Agent Lifecycle

```typescript
import { MultiAgentOrchestrator } from './orchestrator/multi-agent-orchestrator';

const orchestrator = new MultiAgentOrchestrator(DATABASE_URL);
await orchestrator.initialize();

// Register agent
const agent = await orchestrator.registerAgent({
  name: 'Schema Evolution Agent',
  type: 'schema-evolution',
  enabled: true,
  forkStrategy: 'now',
  autoStart: true
});

// Submit task
const taskId = await orchestrator.submitTask(
  agent.id,
  'analyze',
  { timeframe: '7 days' },
  10  // priority
);

// Monitor task
const task = await orchestrator.getTaskStatus(taskId);

// Stop agent
await orchestrator.stopAgent(agent.id);
```

### Agent Configuration

```typescript
interface AgentConfig {
  name: string;
  type: 'schema-evolution' | 'query-validator' |
        'learning-aggregator' | 'ab-testing' | 'custom';
  enabled: boolean;
  forkStrategy: 'now' | 'last-snapshot' | 'to-timestamp';
  cpu?: string;
  memory?: string;
  autoStart?: boolean;
}
```

### Agent States

- `initializing` - Being set up
- `running` - Active and processing tasks
- `idle` - No current tasks
- `error` - Error occurred
- `stopped` - Shut down

### Inter-Agent Communication

```typescript
// Send message
await orchestrator.sendMessage(
  fromAgentId,
  toAgentId,
  'recommendation',
  { data: '...' }
);

// Receive messages
const messages = await orchestrator.getMessages(agentId, true);

for (const msg of messages) {
  console.log(`From: ${msg.from_agent_id}`);
  console.log(`Type: ${msg.message_type}`);
  console.log(`Data: ${msg.payload}`);

  // Mark as read
  await orchestrator.markMessageRead(msg.id);
}
```

---

## Fork Synchronization

**Purpose:** Enable knowledge sharing between isolated forks.

### Sync Modes

**1. Incremental Sync**
Only new/updated records (based on timestamp).

```typescript
await synchronizer.createSyncJob({
  source: 'fork-1',
  target: 'fork-2',
  tables: ['neurobase_learning_history'],
  mode: 'incremental',
  direction: 'push',
  conflictResolution: 'source-wins'
});
```

**2. Full Sync**
Complete data copy.

```typescript
await synchronizer.createSyncJob({
  source: 'fork-1',
  target: 'fork-2',
  tables: ['users', 'orders'],
  mode: 'full',
  direction: 'push',
  conflictResolution: 'source-wins'
});
```

**3. Selective Sync**
Filter-based synchronization.

```typescript
await synchronizer.createSyncJob({
  source: 'fork-1',
  target: 'fork-2',
  tables: ['neurobase_learning_history'],
  mode: 'selective',
  direction: 'push',
  conflictResolution: 'merge'
});
```

### Sync Directions

- **push** - Source → Target
- **pull** - Target ← Source
- **bidirectional** - Both ways

### Conflict Resolution

- **source-wins** - Source data takes precedence
- **target-wins** - Target data takes precedence
- **merge** - Attempt to merge both
- **manual** - Requires manual resolution

### Learning Data Sync

```typescript
// Sync learning between two agents
const synced = await synchronizer.syncLearningData(
  'agent-1-fork',
  'agent-2-fork'
);

// Merge from multiple agents
const merged = await synchronizer.mergeLearningData(
  ['fork-1', 'fork-2', 'fork-3'],
  'main'
);

console.log(`Merged ${merged} learning entries`);
```

### Automatic Sync

```typescript
// Start auto-sync every 5 minutes
synchronizer.startAutoSync(300000);

// Stop auto-sync
synchronizer.stopAutoSync();
```

---

## Monitoring Dashboard

Access the dashboard at `http://localhost:3000/dashboard`

### Features

- **System Overview**
  - Total agents
  - Active agents
  - Total tasks
  - System uptime

- **Performance Metrics**
  - Average query time
  - Error rate
  - Cache hit rate

- **Agent Status**
  - Individual agent cards
  - Status indicators (🟢 running, 🟡 idle, 🔴 error)
  - Task counts
  - Success rates

- **Synchronization**
  - Active sync jobs
  - Records synced
  - Job history

- **Event Stream**
  - Real-time events
  - Agent activities
  - Errors and warnings

- **Auto-Refresh**
  - Updates every 10 seconds
  - Manual refresh button
  - Countdown timer

---

## Event System

### Subscribing to Events

```typescript
orchestrator.on((event) => {
  console.log(`Event: ${event.type}`);

  switch (event.type) {
    case 'agent:started':
      console.log(`Agent ${event.agentId} started`);
      break;

    case 'task:completed':
      console.log(`Task completed by ${event.agentId}`);
      break;

    case 'sync:completed':
      console.log(`Synced ${event.data.recordsSynced} records`);
      break;

    case 'agent:error':
      console.error(`Error in agent ${event.agentId}`);
      break;
  }
});
```

### Event Types

- `agent:started` - Agent started successfully
- `agent:stopped` - Agent stopped
- `agent:error` - Agent encountered error
- `task:completed` - Task finished
- `fork:created` - Database fork created
- `sync:started` - Sync job started
- `sync:completed` - Sync job completed

---

## Complete Example

```typescript
import { MultiAgentOrchestrator } from './orchestrator/multi-agent-orchestrator';
import { ForkSynchronizer } from './orchestrator/fork-synchronizer';
import { Pool } from 'pg';

async function main() {
  // Initialize
  const mainPool = new Pool({ connectionString: DATABASE_URL });
  const orchestrator = new MultiAgentOrchestrator(DATABASE_URL);
  await orchestrator.initialize();

  const synchronizer = new ForkSynchronizer(mainPool);

  // Register agents
  const schemaAgent = await orchestrator.registerAgent({
    name: 'Schema Evolution',
    type: 'schema-evolution',
    enabled: true,
    forkStrategy: 'now',
    autoStart: true
  });

  const validatorAgent = await orchestrator.registerAgent({
    name: 'Query Validator',
    type: 'query-validator',
    enabled: true,
    forkStrategy: 'now',
    autoStart: true
  });

  console.log('Agents registered');

  // Submit tasks
  await orchestrator.submitTask(
    schemaAgent.id,
    'analyze',
    { timeframe: '7 days' },
    10
  );

  // Setup sync
  synchronizer.startAutoSync(300000);

  // Monitor events
  orchestrator.on((event) => {
    console.log(`[${event.type}]`, event.data);
  });

  // Get statistics
  const stats = await orchestrator.getStatistics();
  console.log('Statistics:', stats);
}

main();
```

---

## Configuration

### Environment Variables

```bash
# Multi-Agent System
ENABLE_MULTI_AGENT=true
MAX_AGENTS=10
AUTO_SYNC_INTERVAL=300000  # 5 minutes

# Agent Settings
SCHEMA_ANALYSIS_INTERVAL=3600000  # 1 hour
LEARNING_AGGREGATION_INTERVAL=1800000  # 30 minutes

# Dashboard
DASHBOARD_PORT=3000
DASHBOARD_REFRESH_INTERVAL=10000  # 10 seconds
```

---

## Performance

- **Fork Creation**: ~2 seconds
- **Agent Startup**: 3-5 seconds
- **Connections per Agent**: ~5
- **Memory per Agent**: ~50MB
- **Sync Rate**: 100-1000 records/second

---

## Best Practices

1. **Use appropriate fork strategy**
   - `now` for latest data
   - `last-snapshot` for faster creation
   - `to-timestamp` for specific point-in-time

2. **Monitor agent health**
   - Check dashboard regularly
   - Set up event handlers
   - Track error rates

3. **Optimize sync frequency**
   - Balance freshness vs overhead
   - Use incremental sync when possible
   - Schedule during low-traffic periods

4. **Limit concurrent agents**
   - 5-10 agents recommended
   - Monitor resource usage
   - Scale horizontally if needed

5. **Clean up unused forks**
   - Delete forks when agents stop
   - Monitor fork count
   - Set retention policies
