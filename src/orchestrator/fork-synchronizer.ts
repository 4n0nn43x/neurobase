/**
 * Fork Synchronizer
 * Synchronizes data and learning between database forks
 * Enables agents to share knowledge across isolated environments
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface SyncConfig {
  source: string; // Source fork/agent ID
  target: string; // Target fork/agent ID
  tables: string[]; // Tables to synchronize
  mode: 'incremental' | 'full' | 'selective';
  direction: 'push' | 'pull' | 'bidirectional';
  conflictResolution: 'source-wins' | 'target-wins' | 'merge' | 'manual';
}

export interface SyncJob {
  id: string;
  config: SyncConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  startTime?: Date;
  endTime?: Date;
  recordsSynced: number;
  errors: string[];
}

export interface SyncStrategy {
  table: string;
  primaryKey: string;
  timestampColumn?: string;
  filter?: string;
}

export class ForkSynchronizer {
  private mainPool: Pool;
  private pools: Map<string, Pool> = new Map();
  private syncJobs: Map<string, SyncJob> = new Map();
  private syncInterval?: NodeJS.Timeout;

  constructor(mainPool: Pool) {
    this.mainPool = mainPool;
  }

  /**
   * Register a fork for synchronization
   */
  registerFork(forkId: string, connectionString: string): void {
    if (!this.pools.has(forkId)) {
      const pool = new Pool({
        connectionString,
        max: 5,
      });

      this.pools.set(forkId, pool);
      logger.info({ forkId }, 'Fork registered for synchronization');
    }
  }

  /**
   * Unregister a fork
   */
  async unregisterFork(forkId: string): Promise<void> {
    const pool = this.pools.get(forkId);
    if (pool) {
      await pool.end();
      this.pools.delete(forkId);
      logger.info({ forkId }, 'Fork unregistered from synchronization');
    }
  }

  /**
   * Create a sync job
   */
  async createSyncJob(config: SyncConfig): Promise<SyncJob> {
    const jobId = `sync-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const job: SyncJob = {
      id: jobId,
      config,
      status: 'pending',
      progress: 0,
      recordsSynced: 0,
      errors: [],
    };

    this.syncJobs.set(jobId, job);

    // Store in database
    await this.storeSyncJob(job);

    logger.info({ jobId, config }, 'Sync job created');

    return job;
  }

  /**
   * Execute a sync job
   */
  async executeSync(jobId: string): Promise<SyncJob> {
    const job = this.syncJobs.get(jobId);
    if (!job) {
      throw new Error(`Sync job ${jobId} not found`);
    }

    logger.info({ jobId }, 'Executing sync job');

    job.status = 'running';
    job.startTime = new Date();
    job.progress = 0;

    try {
      // Get source and target pools
      const sourcePool = this.getPool(job.config.source);
      const targetPool = this.getPool(job.config.target);

      // Sync each table
      for (let i = 0; i < job.config.tables.length; i++) {
        const table = job.config.tables[i];

        logger.info({ table, jobId }, 'Syncing table');

        const recordsSynced = await this.syncTable(
          sourcePool,
          targetPool,
          table,
          job.config
        );

        job.recordsSynced += recordsSynced;
        job.progress = ((i + 1) / job.config.tables.length) * 100;

        await this.updateSyncJob(job);
      }

      job.status = 'completed';
      job.endTime = new Date();
      job.progress = 100;

      await this.updateSyncJob(job);

      logger.info(
        { jobId, recordsSynced: job.recordsSynced },
        'Sync job completed successfully'
      );

      return job;
    } catch (error: any) {
      job.status = 'failed';
      job.endTime = new Date();
      job.errors.push(error.message);

      await this.updateSyncJob(job);

      logger.error({ error, jobId }, 'Sync job failed');
      throw error;
    }
  }

  /**
   * Sync a single table
   */
  private async syncTable(
    sourcePool: Pool,
    targetPool: Pool,
    tableName: string,
    config: SyncConfig
  ): Promise<number> {
    let recordsSynced = 0;

    try {
      // Get table structure
      const strategy = await this.getTableStrategy(sourcePool, tableName);

      if (config.mode === 'incremental' && strategy.timestampColumn) {
        // Incremental sync: only sync new/updated records
        recordsSynced = await this.incrementalSync(
          sourcePool,
          targetPool,
          tableName,
          strategy
        );
      } else if (config.mode === 'selective') {
        // Selective sync: sync based on filter
        recordsSynced = await this.selectiveSync(
          sourcePool,
          targetPool,
          tableName,
          strategy,
          config
        );
      } else {
        // Full sync: copy all data
        recordsSynced = await this.fullSync(sourcePool, targetPool, tableName);
      }

      return recordsSynced;
    } catch (error) {
      logger.error({ error, tableName }, 'Error syncing table');
      throw error;
    }
  }

  /**
   * Get synchronization strategy for table
   */
  private async getTableStrategy(pool: Pool, tableName: string): Promise<SyncStrategy> {
    // Get primary key
    const pkResult = await pool.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
    `, [tableName]);

    const primaryKey = pkResult.rows[0]?.attname || 'id';

    // Check for timestamp columns
    const timestampResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = $1
      AND (column_name LIKE '%timestamp%' OR column_name LIKE '%updated%' OR column_name = 'updated_at')
      ORDER BY ordinal_position
      LIMIT 1
    `, [tableName]);

    const timestampColumn = timestampResult.rows[0]?.column_name;

    return {
      table: tableName,
      primaryKey,
      timestampColumn,
    };
  }

  /**
   * Full synchronization
   */
  private async fullSync(
    sourcePool: Pool,
    targetPool: Pool,
    tableName: string
  ): Promise<number> {
    logger.debug({ tableName }, 'Performing full sync');

    // Get all data from source
    const sourceData = await sourcePool.query(`SELECT * FROM ${tableName}`);

    if (sourceData.rows.length === 0) {
      return 0;
    }

    // Get column names
    const columns = Object.keys(sourceData.rows[0]);

    // Clear target table (be careful!)
    await targetPool.query(`TRUNCATE TABLE ${tableName} CASCADE`);

    // Insert all rows
    let inserted = 0;
    for (const row of sourceData.rows) {
      const values = columns.map(col => row[col]);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

      await targetPool.query(
        `INSERT INTO ${tableName} (${columns.join(', ')})
         VALUES (${placeholders})`,
        values
      );

      inserted++;
    }

    logger.info({ tableName, inserted }, 'Full sync completed');

    return inserted;
  }

  /**
   * Incremental synchronization (only new/updated records)
   */
  private async incrementalSync(
    sourcePool: Pool,
    targetPool: Pool,
    tableName: string,
    strategy: SyncStrategy
  ): Promise<number> {
    logger.debug({ tableName }, 'Performing incremental sync');

    if (!strategy.timestampColumn) {
      throw new Error(`No timestamp column found for incremental sync on ${tableName}`);
    }

    // Get last sync timestamp from target
    const lastSyncResult = await targetPool.query(
      `SELECT MAX(${strategy.timestampColumn}) as last_sync FROM ${tableName}`
    );

    const lastSync = lastSyncResult.rows[0]?.last_sync || '1970-01-01';

    // Get new/updated records from source
    const sourceData = await sourcePool.query(
      `SELECT * FROM ${tableName}
       WHERE ${strategy.timestampColumn} > $1
       ORDER BY ${strategy.timestampColumn}`,
      [lastSync]
    );

    if (sourceData.rows.length === 0) {
      return 0;
    }

    // Upsert records into target
    const columns = Object.keys(sourceData.rows[0]);
    let synced = 0;

    for (const row of sourceData.rows) {
      const values = columns.map(col => row[col]);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const updates = columns
        .filter(col => col !== strategy.primaryKey)
        .map(col => `${col} = EXCLUDED.${col}`)
        .join(', ');

      await targetPool.query(
        `INSERT INTO ${tableName} (${columns.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (${strategy.primaryKey})
         DO UPDATE SET ${updates}`,
        values
      );

      synced++;
    }

    logger.info({ tableName, synced }, 'Incremental sync completed');

    return synced;
  }

  /**
   * Selective synchronization (with filter)
   */
  private async selectiveSync(
    sourcePool: Pool,
    targetPool: Pool,
    tableName: string,
    strategy: SyncStrategy,
    config: SyncConfig
  ): Promise<number> {
    logger.debug({ tableName }, 'Performing selective sync');

    const filter = strategy.filter || '';

    // Get filtered data from source
    const query = `SELECT * FROM ${tableName} ${filter ? `WHERE ${filter}` : ''}`;
    const sourceData = await sourcePool.query(query);

    if (sourceData.rows.length === 0) {
      return 0;
    }

    // Upsert records into target
    const columns = Object.keys(sourceData.rows[0]);
    let synced = 0;

    for (const row of sourceData.rows) {
      const values = columns.map(col => row[col]);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const updates = columns
        .filter(col => col !== strategy.primaryKey)
        .map(col => `${col} = EXCLUDED.${col}`)
        .join(', ');

      try {
        await targetPool.query(
          `INSERT INTO ${tableName} (${columns.join(', ')})
           VALUES (${placeholders})
           ON CONFLICT (${strategy.primaryKey})
           DO UPDATE SET ${updates}`,
          values
        );

        synced++;
      } catch (error) {
        logger.warn({ error, tableName }, 'Error syncing record');
      }
    }

    logger.info({ tableName, synced }, 'Selective sync completed');

    return synced;
  }

  /**
   * Sync learning data between forks
   */
  async syncLearningData(sourceForkId: string, targetForkId: string): Promise<number> {
    logger.info({ sourceForkId, targetForkId }, 'Syncing learning data');

    const sourcePool = this.getPool(sourceForkId);
    const targetPool = this.getPool(targetForkId);

    // Sync learning tables
    const tables = ['neurobase_learning_history', 'neurobase_corrections'];

    let totalSynced = 0;

    for (const table of tables) {
      try {
        const synced = await this.syncTable(sourcePool, targetPool, table, {
          source: sourceForkId,
          target: targetForkId,
          tables: [table],
          mode: 'incremental',
          direction: 'push',
          conflictResolution: 'source-wins',
        });

        totalSynced += synced;
      } catch (error) {
        logger.error({ error, table }, 'Error syncing learning table');
      }
    }

    logger.info({ totalSynced }, 'Learning data sync completed');

    return totalSynced;
  }

  /**
   * Merge learning data from multiple forks
   */
  async mergeLearningData(forkIds: string[], targetForkId: string): Promise<number> {
    logger.info({ forkIds, targetForkId }, 'Merging learning data from multiple forks');

    let totalMerged = 0;

    for (const sourceForkId of forkIds) {
      if (sourceForkId === targetForkId) continue;

      try {
        const synced = await this.syncLearningData(sourceForkId, targetForkId);
        totalMerged += synced;
      } catch (error) {
        logger.error({ error, sourceForkId }, 'Error merging from fork');
      }
    }

    logger.info({ totalMerged }, 'Learning data merge completed');

    return totalMerged;
  }

  /**
   * Start automatic synchronization
   */
  startAutoSync(intervalMs: number = 300000): void {
    logger.info({ intervalMs }, 'Starting automatic synchronization');

    this.syncInterval = setInterval(async () => {
      try {
        // Sync pending jobs
        const pendingJobs = Array.from(this.syncJobs.values()).filter(
          j => j.status === 'pending'
        );

        for (const job of pendingJobs) {
          try {
            await this.executeSync(job.id);
          } catch (error) {
            logger.error({ error, jobId: job.id }, 'Auto sync failed');
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error in auto sync');
      }
    }, intervalMs);
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
      logger.info('Automatic synchronization stopped');
    }
  }

  /**
   * Get pool by fork/agent ID
   */
  private getPool(id: string): Pool {
    // Check if it's a fork ID
    let pool = this.pools.get(id);

    if (!pool) {
      // Might be main pool
      pool = this.mainPool;
    }

    if (!pool) {
      throw new Error(`No pool found for ID: ${id}`);
    }

    return pool;
  }

  /**
   * Store sync job in database
   */
  private async storeSyncJob(job: SyncJob): Promise<void> {
    await this.mainPool.query(`
      CREATE TABLE IF NOT EXISTS neurobase_sync_jobs (
        id TEXT PRIMARY KEY,
        config JSONB NOT NULL,
        status TEXT NOT NULL,
        progress NUMERIC DEFAULT 0,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        records_synced INTEGER DEFAULT 0,
        errors JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await this.mainPool.query(
      `INSERT INTO neurobase_sync_jobs (id, config, status, progress, records_synced, errors)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        job.id,
        JSON.stringify(job.config),
        job.status,
        job.progress,
        job.recordsSynced,
        JSON.stringify(job.errors),
      ]
    );
  }

  /**
   * Update sync job in database
   */
  private async updateSyncJob(job: SyncJob): Promise<void> {
    await this.mainPool.query(
      `UPDATE neurobase_sync_jobs
       SET status = $1, progress = $2, start_time = $3, end_time = $4, records_synced = $5, errors = $6
       WHERE id = $7`,
      [
        job.status,
        job.progress,
        job.startTime,
        job.endTime,
        job.recordsSynced,
        JSON.stringify(job.errors),
        job.id,
      ]
    );
  }

  /**
   * Get sync job by ID
   */
  getSyncJob(jobId: string): SyncJob | undefined {
    return this.syncJobs.get(jobId);
  }

  /**
   * Get all sync jobs
   */
  getAllSyncJobs(): SyncJob[] {
    return Array.from(this.syncJobs.values());
  }

  /**
   * Get statistics
   */
  getStatistics(): any {
    const jobs = Array.from(this.syncJobs.values());

    return {
      registeredForks: this.pools.size,
      totalJobs: jobs.length,
      pendingJobs: jobs.filter(j => j.status === 'pending').length,
      runningJobs: jobs.filter(j => j.status === 'running').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      totalRecordsSynced: jobs.reduce((sum, j) => sum + j.recordsSynced, 0),
      autoSyncEnabled: this.syncInterval !== undefined,
    };
  }

  /**
   * Cleanup
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Fork Synchronizer');

    this.stopAutoSync();

    // Close all pools
    for (const [forkId, pool] of this.pools.entries()) {
      await pool.end();
      logger.debug({ forkId }, 'Pool closed');
    }

    this.pools.clear();

    logger.info('Fork Synchronizer shut down successfully');
  }
}
