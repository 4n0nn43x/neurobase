# NeuroBase API Documentation

Complete API reference for NeuroBase.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [TypeScript/JavaScript API](#typescriptjavascript-api)
3. [REST API](#rest-api)
4. [CLI Commands](#cli-commands)
5. [Events](#events)
6. [Error Handling](#error-handling)

---

## Getting Started

### Installation

```bash
npm install neurobase
# or
yarn add neurobase
```

### Basic Usage

```typescript
import { NeuroBase } from 'neurobase';
import { loadConfig } from 'neurobase/config';

const config = loadConfig();
const nb = new NeuroBase(config);

await nb.initialize();

const result = await nb.query("Show me all users");
console.log(result.data);

await nb.close();
```

---

## TypeScript/JavaScript API

### NeuroBase Class

#### Constructor

```typescript
constructor(config: Config)
```

Creates a new NeuroBase instance.

**Parameters:**
- `config`: Configuration object (see [Configuration](#configuration))

**Example:**
```typescript
const nb = new NeuroBase({
  tiger: {
    serviceId: 'your-service-id',
    host: 'your-host.tigerdata.cloud',
    port: 5432,
    database: 'tsdb',
    user: 'postgres',
    password: 'your-password',
  },
  llm: {
    provider: 'openai',
    openai: {
      apiKey: 'sk-...',
      model: 'gpt-4-turbo-preview',
      temperature: 0.1,
      maxTokens: 2000,
    },
  },
  // ... other config
});
```

---

### Methods

#### initialize()

```typescript
async initialize(): Promise<void>
```

Initializes NeuroBase (tests connection, creates tables, introspects schema).

**Returns:** Promise that resolves when initialization is complete

**Throws:** Error if connection fails

**Example:**
```typescript
await nb.initialize();
```

---

#### query()

```typescript
async query(query: string | NaturalLanguageQuery): Promise<QueryResult>
```

Execute a natural language query.

**Parameters:**
- `query`: String or NaturalLanguageQuery object

**Returns:** QueryResult object

**Example:**
```typescript
// Simple query
const result = await nb.query("Show me the top 10 customers");

// With options
const result = await nb.query({
  text: "Show me recent orders",
  userId: "user123",
  conversationId: "conv456",
  context: {
    previousQueries: ["Show me all orders"],
  },
});
```

**QueryResult:**
```typescript
interface QueryResult {
  data: any[];                 // Query results
  sql: string;                 // Generated SQL
  executionTime: number;       // Time in milliseconds
  rowCount: number;            // Number of rows returned
  explanation?: string;        // Query explanation
  suggestions?: string[];      // Optimization suggestions
  learned?: boolean;           // Whether this was stored in learning history
}
```

---

#### correct()

```typescript
async correct(
  originalQuery: string,
  correctSQL: string,
  reason?: string
): Promise<void>
```

Provide a correction for a previous query.

**Parameters:**
- `originalQuery`: The original natural language query
- `correctSQL`: The correct SQL
- `reason`: Optional reason for the correction

**Example:**
```typescript
await nb.correct(
  "Show me inactive users",
  "SELECT * FROM users WHERE last_login < NOW() - INTERVAL '90 days'",
  "Inactive means no login in 90 days, not 30 days"
);
```

---

#### getSuggestions()

```typescript
async getSuggestions(userId?: string): Promise<string[]>
```

Get query suggestions based on schema and history.

**Parameters:**
- `userId`: Optional user ID for personalized suggestions

**Returns:** Array of suggested queries

**Example:**
```typescript
const suggestions = await nb.getSuggestions("user123");
console.log(suggestions);
// [
//   "Show me all data from users",
//   "How many records are in products?",
//   "Show recent orders",
// ]
```

---

#### getStats()

```typescript
async getStats(): Promise<DatabaseStats>
```

Get database and schema statistics.

**Returns:** Statistics object

**Example:**
```typescript
const stats = await nb.getStats();
console.log(stats);
// {
//   database: {
//     size: "125 MB",
//     tables: 5,
//     connections: 3
//   },
//   schema: {
//     tables: 5,
//     views: 2,
//     functions: 3
//   }
// }
```

---

#### on()

```typescript
on(handler: EventHandler): void
```

Register an event handler.

**Parameters:**
- `handler`: Function to handle events

**Example:**
```typescript
nb.on((event) => {
  switch (event.type) {
    case 'query:start':
      console.log('Query started:', event.payload.query);
      break;
    case 'query:complete':
      console.log('Query completed:', event.payload.rowCount, 'rows');
      break;
    case 'query:error':
      console.error('Query failed:', event.payload.error);
      break;
  }
});
```

---

#### refreshSchema()

```typescript
async refreshSchema(): Promise<void>
```

Manually refresh the schema cache.

**Example:**
```typescript
await nb.refreshSchema();
```

---

#### close()

```typescript
async close(): Promise<void>
```

Close all database connections.

**Example:**
```typescript
await nb.close();
```

---

### Configuration

```typescript
interface Config {
  tiger: TigerConfig;
  llm: LLMConfig;
  neurobase: NeuroBaseConfig;
  features: FeatureFlags;
  security: SecurityConfig;
}
```

#### TigerConfig

```typescript
interface TigerConfig {
  serviceId: string;    // Tiger Cloud service ID
  host: string;         // Database host
  port: number;         // Database port (default: 5432)
  database: string;     // Database name
  user: string;         // Database user
  password: string;     // Database password
}
```

#### LLMConfig

```typescript
interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama';
  openai?: OpenAIConfig;
  anthropic?: AnthropicConfig;
  ollama?: OllamaConfig;
}

interface OpenAIConfig {
  apiKey: string;
  model: string;           // e.g., "gpt-4-turbo-preview"
  temperature: number;     // 0-1, default: 0.1
  maxTokens: number;       // default: 2000
}

interface AnthropicConfig {
  apiKey: string;
  model: string;           // e.g., "claude-3-5-sonnet-20241022"
  temperature: number;
  maxTokens: number;
}

interface OllamaConfig {
  baseUrl: string;         // e.g., "http://localhost:11434"
  model: string;           // e.g., "llama3.2"
  temperature: number;
}
```

#### FeatureFlags

```typescript
interface FeatureFlags {
  enableLearning: boolean;           // Default: true
  enableOptimization: boolean;       // Default: true
  enableSchemaSuggestions: boolean;  // Default: true
  enableQueryCache: boolean;         // Default: true
}
```

#### SecurityConfig

```typescript
interface SecurityConfig {
  apiRateLimit: number;     // Requests per 15 minutes
  readonlyMode: boolean;    // Restrict to SELECT queries
  maxQueryTime: number;     // Max execution time in ms
}
```

---

## REST API

### Start API Server

```bash
npm run serve
# Server starts on port 3000 (configurable via NEUROBASE_PORT)
```

---

### Endpoints

#### POST /api/query

Execute a natural language query.

**Request:**
```json
{
  "query": "Show me the top 5 products by sales",
  "userId": "user123",
  "conversationId": "conv456",
  "includeExplanation": true,
  "includeSuggestions": true,
  "dryRun": false
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Product A", "sales": 1500 },
    { "id": 2, "name": "Product B", "sales": 1200 }
  ],
  "sql": "SELECT id, name, sales FROM products ORDER BY sales DESC LIMIT 5",
  "executionTime": 45,
  "rowCount": 5,
  "explanation": "This query retrieves the top 5 products sorted by sales in descending order",
  "suggestions": ["Consider adding an index on the sales column for better performance"]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to generate SQL: Invalid table name"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Show me all users", "includeExplanation": true}'
```

---

#### GET /api/schema

Get the current database schema.

**Response:**
```json
{
  "success": true,
  "schema": {
    "tables": [
      {
        "name": "users",
        "schema": "public",
        "columns": [
          {
            "name": "id",
            "type": "integer",
            "nullable": false,
            "default": "nextval('users_id_seq'::regclass)"
          }
        ],
        "primaryKeys": ["id"],
        "foreignKeys": [],
        "indexes": []
      }
    ],
    "views": [],
    "functions": []
  }
}
```

---

#### GET /api/suggestions

Get query suggestions.

**Query Parameters:**
- `userId` (optional): User ID for personalized suggestions

**Response:**
```json
{
  "success": true,
  "suggestions": [
    "Show me all data from users",
    "How many records are in products?",
    "Show recent orders"
  ]
}
```

---

#### GET /api/stats

Get database statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "database": {
      "size": "125 MB",
      "tables": 5,
      "connections": 3
    },
    "schema": {
      "tables": 5,
      "views": 2,
      "functions": 3
    }
  }
}
```

---

#### POST /api/correct

Submit a correction.

**Request:**
```json
{
  "originalQuery": "Show me inactive users",
  "correctSQL": "SELECT * FROM users WHERE last_login < NOW() - INTERVAL '90 days'",
  "reason": "Inactive means no login in 90 days"
}
```

**Response:**
```json
{
  "success": true
}
```

---

#### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

## CLI Commands

### Interactive Mode

```bash
neurobase interactive
# or
neurobase i
```

Starts an interactive query session.

**Commands:**
- `.exit` - Exit NeuroBase
- `.help` - Show help
- `.schema` - Show database schema
- `.stats` - Show statistics
- `.clear` - Clear screen

---

### Single Query

```bash
neurobase query "Show me all users"
# or
neurobase q "Show me all users"
```

**Options:**
- `-e, --explain` - Show query explanation
- `-s, --sql` - Show generated SQL

**Example:**
```bash
neurobase query "top 5 products" --explain --sql
```

---

### Initialize

```bash
neurobase init
```

Initialize NeuroBase database tables.

---

### Statistics

```bash
neurobase stats
```

Show database statistics.

---

## Events

### Event Types

```typescript
type NeuroBaseEvent =
  | { type: 'query:start'; payload: { query: string } }
  | { type: 'query:complete'; payload: QueryResult }
  | { type: 'query:error'; payload: { error: Error } }
  | { type: 'learning:new'; payload: LearningEntry }
  | { type: 'optimization:applied'; payload: OptimizationSuggestion }
  | { type: 'schema:updated'; payload: DatabaseSchema };
```

### Usage

```typescript
nb.on((event) => {
  console.log('Event:', event.type, event.payload);
});
```

---

## Error Handling

### Common Errors

#### Database Connection Error

```typescript
try {
  await nb.initialize();
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.error('Cannot connect to database');
  }
}
```

#### LLM API Error

```typescript
try {
  const result = await nb.query("Show me users");
} catch (error) {
  if (error.message.includes('API key')) {
    console.error('Invalid LLM API key');
  }
}
```

#### SQL Syntax Error

```typescript
try {
  const result = await nb.query("invalid query");
} catch (error) {
  if (error.message.includes('syntax error')) {
    console.error('Generated SQL has syntax errors');
  }
}
```

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: any;
}
```

---

## Rate Limiting

API endpoints are rate-limited based on configuration:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642234567
```

When rate limit is exceeded:

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

---

## Authentication

For production use, implement authentication:

```typescript
import express from 'express';
import { NeuroBase } from 'neurobase';

const app = express();

// JWT middleware
app.use(authenticate);

app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  const userId = req.user.id;

  const result = await nb.query({
    text: query,
    userId,
  });

  res.json(result);
});
```

---

## Examples

### Example 1: Basic Query

```typescript
const result = await nb.query("Show me all active users");

console.log(`Found ${result.rowCount} users`);
console.log(result.data);
```

### Example 2: With Event Handling

```typescript
nb.on((event) => {
  if (event.type === 'query:complete') {
    console.log(`Query took ${event.payload.executionTime}ms`);
  }
});

await nb.query("Show me recent orders");
```

### Example 3: Correction Flow

```typescript
// Initial query
const result = await nb.query("Show me inactive users");

// User says: "No, I meant users who haven't logged in for 90 days"

// Submit correction
await nb.correct(
  "Show me inactive users",
  "SELECT * FROM users WHERE last_login < NOW() - INTERVAL '90 days'",
  "Inactive = no login for 90 days"
);

// Next time will be better!
```

### Example 4: Streaming Results

```typescript
const result = await nb.query("Show me all users");

// Process in chunks
for (const user of result.data) {
  console.log(user.name, user.email);
}
```

---

## TypeScript Types

All TypeScript types are exported:

```typescript
import {
  Config,
  QueryResult,
  NaturalLanguageQuery,
  DatabaseSchema,
  NeuroBaseEvent,
} from 'neurobase/types';
```

---

For more information:
- [Architecture Documentation](ARCHITECTURE.md)
- [Deployment Guide](DEPLOYMENT.md)
- [GitHub Repository](https://github.com/yourusername/neurobase)
