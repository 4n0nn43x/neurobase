#!/usr/bin/env node

/**
 * NeuroBase REST API Server
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { NeuroBase } from './core/neurobase';
import { config } from './config';
import { logger } from './utils/logger';
import { APIQueryRequest, APIQueryResponse, APISchemaResponse } from './types';

const app = express();
const port = config.neurobase.port || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.security.apiRateLimit || 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Initialize NeuroBase instance
let nb: NeuroBase;

/**
 * Error handler middleware
 */
const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error({ error: err }, 'API error');
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
};

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * Query endpoint - Natural language to SQL
 * POST /api/query
 */
app.post('/api/query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryRequest: APIQueryRequest = req.body;

    if (!queryRequest.query || typeof queryRequest.query !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Query text is required',
      });
      return;
    }

    logger.debug({ query: queryRequest.query }, 'API query received');

    // If dry run, only generate SQL without executing
    if (queryRequest.dryRun) {
      const linguisticResult = await (nb as any).linguisticAgent.process({
        query: {
          text: queryRequest.query,
          userId: queryRequest.userId,
          conversationId: queryRequest.conversationId,
        },
        schema: await (nb as any).schema.getSchema(),
        learningHistory: [],
      });

      const response: APIQueryResponse = {
        success: true,
        sql: linguisticResult.sql,
        explanation: queryRequest.includeExplanation ? linguisticResult.explanation : undefined,
      };

      res.json(response);
      return;
    }

    // Execute the query
    const result = await nb.query(queryRequest.query);

    const response: APIQueryResponse = {
      success: true,
      data: result.data,
      sql: result.sql,
      executionTime: result.executionTime,
      rowCount: result.rowCount,
      explanation: queryRequest.includeExplanation ? result.explanation : undefined,
      suggestions: queryRequest.includeSuggestions ? result.suggestions : undefined,
    };

    logger.info(
      {
        query: queryRequest.query,
        rowCount: result.rowCount,
        executionTime: result.executionTime,
      },
      'Query executed successfully'
    );

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * Schema endpoint - Get database schema
 * GET /api/schema
 */
app.get('/api/schema', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = await nb.getSchemaIntrospector().getSchema();

    const response: APISchemaResponse = {
      success: true,
      schema,
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * Schema text endpoint - Get schema as text
 * GET /api/schema/text
 */
app.get('/api/schema/text', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const schemaText = await nb.getSchemaIntrospector().getSchemaAsText();

    res.type('text/plain').send(schemaText);
  } catch (error) {
    next(error);
  }
});

/**
 * Schema UML endpoint - Get schema as Mermaid ER diagram
 * GET /api/schema/uml
 */
app.get('/api/schema/uml', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const schemaMermaid = await nb.getSchemaIntrospector().getSchemaAsMermaid();

    res.type('text/plain').send(schemaMermaid);
  } catch (error) {
    next(error);
  }
});

/**
 * Stats endpoint - Get database statistics
 * GET /api/stats
 */
app.get('/api/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await nb.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Learning history endpoint - Get learning entries
 * GET /api/learning
 */
app.get('/api/learning', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    // Query learning history from database
    const db = (nb as any).db;
    const result = await db.query(
      `SELECT id, natural_language, sql, success, corrected, created_at
       FROM neurobase_learning_history
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      success: true,
      entries: result.rows,
      count: result.rowCount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 404 handler
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Error handler
app.use(errorHandler);

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    console.log('🚀 Starting NeuroBase API Server...\n');

    // Initialize NeuroBase
    nb = new NeuroBase(config);
    await nb.initialize();

    console.log('✅ NeuroBase initialized\n');

    // Start listening
    app.listen(port, () => {
      console.log(`🌐 NeuroBase API Server running on http://localhost:${port}`);
      console.log(`\n📚 Available endpoints:`);
      console.log(`   GET  /health              - Health check`);
      console.log(`   POST /api/query           - Execute natural language query`);
      console.log(`   GET  /api/schema          - Get database schema (JSON)`);
      console.log(`   GET  /api/schema/text     - Get database schema (text)`);
      console.log(`   GET  /api/schema/uml      - Get database schema (Mermaid ER diagram)`);
      console.log(`   GET  /api/stats           - Get database statistics`);
      console.log(`   GET  /api/learning        - Get learning history`);
      console.log(`\n💡 Example query:`);
      console.log(`   curl -X POST http://localhost:${port}/api/query \\`);
      console.log(`        -H "Content-Type: application/json" \\`);
      console.log(`        -d '{"query": "show me all products"}'`);
      console.log();
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('\n🛑 SIGTERM received, shutting down gracefully...');
      await nb.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('\n🛑 SIGINT received, shutting down gracefully...');
      await nb.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
