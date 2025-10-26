#!/usr/bin/env node

/**
 * Database initialization script
 * Initializes NeuroBase tables and optionally loads sample data
 */

import { NeuroBase } from '../core/neurobase';
import { config } from '../config';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function main() {
  console.log('🧠 NeuroBase Database Initialization\n');

  try {
    // Initialize NeuroBase
    const nb = new NeuroBase(config);

    console.log('Connecting to database...');
    await nb.initialize();

    console.log('✓ Database connection successful');
    console.log('✓ NeuroBase tables created\n');

    // Ask if user wants to load sample data
    const loadSample = await question(
      'Do you want to load sample e-commerce data? (y/n): '
    );

    if (loadSample.toLowerCase() === 'y') {
      console.log('\nLoading sample data...');

      const db = nb.getDatabase();

      // Read and execute init.sql
      const fs = require('fs');
      const path = require('path');

      const initSQL = fs.readFileSync(
        path.join(__dirname, '../../sql/init.sql'),
        'utf8'
      );
      const seedSQL = fs.readFileSync(
        path.join(__dirname, '../../sql/seed.sql'),
        'utf8'
      );

      await db.query(initSQL);
      console.log('✓ Schema created');

      await db.query(seedSQL);
      console.log('✓ Sample data loaded\n');

      // Show statistics
      const stats = await nb.getStats();
      console.log('Database Statistics:');
      console.log(`  Size: ${stats.database.size}`);
      console.log(`  Tables: ${stats.database.tables}`);
      console.log(`  Views: ${stats.schema.views}`);
      console.log(`  Functions: ${stats.schema.functions}\n`);
    }

    console.log('✓ Initialization complete!\n');
    console.log('Next steps:');
    console.log('  1. Run: npm start (for CLI)');
    console.log('  2. Run: npm run serve (for API server)');
    console.log('  3. Try: "Show me all users"\n');

    await nb.close();
    rl.close();
  } catch (error) {
    console.error('\n❌ Initialization failed:');
    console.error(error instanceof Error ? error.message : error);
    rl.close();
    process.exit(1);
  }
}

main();
