# API Reference

## Base URL

```
http://localhost:3000
```

## Authentication

Currently no authentication required. For production use, implement authentication middleware.

---

## Core API Endpoints

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-31T12:00:00.000Z",
  "version": "2.0.0",
  "agents": {
    "total": 3,
    "running": 2
  }
}
```

---

### Query Execution

```http
POST /api/query
```

Execute a natural language query.

**Request Body:**
```json
{
  "query": "Show me all users created today",
  "userId": "user123",
  "conversationId": "conv456",
  "dryRun": false,
  "includeExplanation": true,
  "includeSuggestions": true
}
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "sql": "SELECT * FROM users WHERE created_at::date = CURRENT_DATE",
  "executionTime": 45,
  "rowCount": 12,
  "explanation": "This query retrieves all users created today...",
  "suggestions": ["Consider adding an index on created_at"]
}
```

---

### Schema Information

```http
GET /api/schema
```

Get database schema as JSON.

**Response:**
```json
{
  "success": true,
  "schema": {
    "tables": [...],
    "views": [...],
    "functions": [...]
  }
}
```

```http
GET /api/schema/text
```

Get schema as formatted text.

```http
GET /api/schema/uml
```

Get schema as Mermaid ER diagram.

---

### Database Statistics

```http
GET /api/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalTables": 8,
    "totalRows": 12540,
    "databaseSize": "45 MB",
    "indexCount": 15
  }
}
```

---

### Learning History

```http
GET /api/learning?limit=10&offset=0
```

Get recent learning entries.

**Response:**
```json
{
  "success": true,
  "entries": [
    {
      "id": "...",
      "natural_language": "show users",
      "sql": "SELECT * FROM users",
      "success": true,
      "created_at": "..."
    }
  ],
  "count": 10
}
```

---

## Multi-Agent API Endpoints

### Agent Management

#### Register Agent

```http
POST /api/agents/register
```

**Request Body:**
```json
{
  "name": "Schema Evolution Agent",
  "type": "schema-evolution",
  "enabled": true,
  "forkStrategy": "now",
  "cpu": "1000m",
  "memory": "512Mi",
  "autoStart": true
}
```

**Response:**
```json
{
  "success": true,
  "agent": {
    "id": "agent-123",
    "name": "Schema Evolution Agent",
    "type": "schema-evolution",
    "status": "initializing"
  }
}
```

---

#### List Agents

```http
GET /api/agents
```

**Response:**
```json
{
  "success": true,
  "agents": [
    {
      "id": "agent-123",
      "name": "Schema Evolution Agent",
      "type": "schema-evolution",
      "status": "running",
      "forkId": "fork-abc",
      "metrics": {
        "tasksProcessed": 45,
        "errors": 2,
        "avgProcessingTime": 1250
      }
    }
  ]
}
```

---

#### Get Agent Details

```http
GET /api/agents/:agentId
```

**Response:**
```json
{
  "success": true,
  "agent": {
    "id": "agent-123",
    "name": "Schema Evolution Agent",
    "type": "schema-evolution",
    "status": "running",
    "forkId": "fork-abc",
    "metrics": {...},
    "lastActivity": "2025-10-31T12:00:00.000Z"
  }
}
```

---

#### Start Agent

```http
POST /api/agents/:agentId/start
```

**Response:**
```json
{
  "success": true,
  "message": "Agent started successfully"
}
```

---

#### Stop Agent

```http
POST /api/agents/:agentId/stop
```

**Request Body:**
```json
{
  "deleteFork": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent stopped successfully"
}
```

---

### Task Management

#### Submit Task

```http
POST /api/agents/:agentId/tasks
```

**Request Body:**
```json
{
  "taskType": "analyze",
  "payload": {
    "timeframe": "7 days",
    "minFrequency": 10
  },
  "priority": 10
}
```

**Response:**
```json
{
  "success": true,
  "taskId": "task-456"
}
```

---

#### Get Task Status

```http
GET /api/tasks/:taskId
```

**Response:**
```json
{
  "success": true,
  "task": {
    "id": "task-456",
    "agent_id": "agent-123",
    "task_type": "analyze",
    "status": "completed",
    "result": {...},
    "created_at": "...",
    "completed_at": "..."
  }
}
```

---

### Query Validation

```http
POST /api/validate
```

Validate a SQL query before execution.

**Request Body:**
```json
{
  "sql": "SELECT * FROM users WHERE id = 1"
}
```

**Response:**
```json
{
  "success": true,
  "validation": {
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
}
```

---

### Fork Synchronization

#### Create Sync Job

```http
POST /api/sync
```

**Request Body:**
```json
{
  "source": "agent-1-fork",
  "target": "agent-2-fork",
  "tables": ["neurobase_learning_history", "neurobase_corrections"],
  "mode": "incremental",
  "direction": "push",
  "conflictResolution": "source-wins"
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "sync-789",
  "status": "pending"
}
```

---

#### Get Sync Job Status

```http
GET /api/sync/:jobId
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "sync-789",
    "status": "completed",
    "progress": 100,
    "recordsSynced": 1250,
    "errors": []
  }
}
```

---

#### List Sync Jobs

```http
GET /api/sync
```

**Response:**
```json
{
  "success": true,
  "jobs": [
    {
      "id": "sync-789",
      "status": "completed",
      "progress": 100,
      "recordsSynced": 1250
    }
  ]
}
```

---

### A/B Testing

#### Create Experiment

```http
POST /api/experiments
```

**Request Body:**
```json
{
  "name": "SQL Generation Strategies",
  "description": "Compare different LLM approaches",
  "strategies": [
    {
      "id": "strategy-a",
      "name": "GPT-4 with examples",
      "type": "sql-generation",
      "config": {...}
    },
    {
      "id": "strategy-b",
      "name": "Claude with schema",
      "type": "sql-generation",
      "config": {...}
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "experimentId": "exp-123"
}
```

---

#### List Experiments

```http
GET /api/experiments
```

**Response:**
```json
{
  "success": true,
  "experiments": [...]
}
```

---

### Insights & Learning

#### Get Insights

```http
GET /api/insights?type=cross-agent&impact=high
```

**Response:**
```json
{
  "success": true,
  "insights": [
    {
      "id": "insight-123",
      "type": "cross-agent",
      "description": "Pattern observed across 3 agents",
      "confidence": 0.92,
      "impact": "high",
      "actionable": true
    }
  ]
}
```

---

#### Get Knowledge Graph

```http
GET /api/knowledge-graph
```

**Response:**
```json
{
  "success": true,
  "graph": {
    "nodes": [
      {
        "id": "query-1",
        "type": "query",
        "label": "SELECT users",
        "weight": 12.5
      }
    ],
    "edges": [
      {
        "from": "query-1",
        "to": "table-users",
        "relationship": "accesses",
        "weight": 1.0
      }
    ]
  }
}
```

---

### Statistics & Monitoring

#### System Statistics

```http
GET /api/statistics
```

**Response:**
```json
{
  "success": true,
  "statistics": {
    "totalAgents": 4,
    "runningAgents": 3,
    "idleAgents": 1,
    "totalTasksProcessed": 1250,
    "totalErrors": 12,
    "avgProcessingTime": 850,
    "pendingTasks": 5
  }
}
```

---

#### Dashboard Metrics

```http
GET /api/dashboard/metrics
```

Get all dashboard metrics in one call.

**Response:**
```json
{
  "system": {...},
  "agents": [...],
  "forks": [...],
  "synchronization": {...},
  "performance": {...},
  "insights": {...}
}
```

---

#### Recent Events

```http
GET /api/dashboard/events?limit=50
```

**Response:**
```json
[
  {
    "type": "agent:started",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "agentId": "agent-123",
    "data": {...}
  }
]
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (validation error)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## Rate Limiting

Default: 100 requests per 15 minutes per IP.

When rate limit exceeded:
```json
{
  "success": false,
  "error": "Too many requests from this IP, please try again later."
}
```

---

## Examples

### cURL

```bash
# Query
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "show all users"}'

# Register Agent
curl -X POST http://localhost:3000/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent",
    "type": "schema-evolution",
    "enabled": true,
    "forkStrategy": "now"
  }'

# Validate Query
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users"}'
```

### JavaScript

```javascript
// Query
const response = await fetch('http://localhost:3000/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "Show me products with low stock"
  })
});

const result = await response.json();
console.log(result.data);
```

### Python

```python
import requests

# Query
response = requests.post('http://localhost:3000/api/query', json={
    'query': 'show all users'
})

data = response.json()
print(data['data'])
```
