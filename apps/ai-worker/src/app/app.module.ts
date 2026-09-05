import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  AiBackfillCursorRepository,
  AiBatchRepository,
  AiCompletionCache,
  AiCostLogRepository,
  AiDlqRepository,
  AiJobDlqRepository,
  AiOutputRepository,
  ProposalEmbeddingScanRepository,
  ProposalEmbeddingWriter,
  ProposalEmbeddingRepository,
  ProposalMismatchScanRepository,
  ProposalSummaryScanRepository,
  SystemClock,
  type LLMClient,
} from '@libs/ai';
import { ProposalReadRepository, ProposalRepository, pgDb } from '@libs/db';
import { ForumThreadReadRepository } from '@sources/forum';
import { OpsServer } from '@nest/observability';
import { ShutdownLogger } from './shutdown-logger';
import { AiBackfillConfig } from '../backfill/ai-backfill-config';
import { AiBackfillService } from '../backfill/ai-backfill.service';
import { DurableBatch } from '../batch/durable-batch';
import { AiBudgetCapService } from '../budget/ai-budget-cap.service';
import { AiBudgetState } from '../budget/ai-budget-state';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { AiJobDlqBridge } from '../consumer/ai-job-dlq.bridge';
import { AiJobConsumer } from '../consumer/ai-job.consumer';
import { ProposalEmbeddingHandler } from '../embedding/proposal-embedding.handler';
import { ForumSynthesisBatchService } from '../forum/forum-synthesis-batch.service';
import { ForumSynthesisAssembler } from '../forum/forum-synthesis.assembler';
import { ForumSynthesisHandler } from '../forum/forum-synthesis.handler';
import { LLM_CLIENT, createWorkerLlmClient } from '../llm/llm.provider';
import { AiQueueMetricsService } from '../metrics/ai-queue-metrics.service';
import { MismatchAssembler } from '../mismatch/mismatch.assembler';
import { MismatchHandler } from '../mismatch/mismatch.handler';
import { AiJobQueueService } from '../queue/ai-job-queue.service';
import { AI_QUEUE_PORT } from '../queue/ai-queue.port';
import { ProposalSummaryBatchService } from '../summarizer/proposal-summary-batch.service';
import { ProposalSummaryAssembler } from '../summarizer/proposal-summary.assembler';
import { ProposalSummaryHandler } from '../summarizer/proposal-summary.handler';
import { AiBatchCycleService } from '../trigger/ai-batch-cycle.service';
import { AiTriggerConfig } from '../trigger/ai-trigger-config';
import { AiTriggerScanService } from '../trigger/ai-trigger-scan.service';
import { AiTriggerScanner } from '../trigger/ai-trigger-scanner';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    ShutdownLogger,
    OpsServer,
    AiJobQueueService,
    { provide: AI_QUEUE_PORT, useExisting: AiJobQueueService },
    { provide: ProposalRepository, useFactory: () => new ProposalRepository(pgDb) },
    { provide: AiJobDlqRepository, useFactory: () => new AiJobDlqRepository(pgDb) },
    AiFeatureHandlerRegistry,
    AiJobConsumer,
    AiJobDlqBridge,
    AiTriggerConfig,
    AiTriggerScanner,
    AiTriggerScanService,
    AiBatchCycleService,
    AiQueueMetricsService,
    AiBudgetState,
    { provide: AiCostLogRepository, useFactory: () => new AiCostLogRepository(pgDb) },
    AiBudgetCapService,
    { provide: ProposalReadRepository, useFactory: () => new ProposalReadRepository(pgDb) },
    { provide: AiOutputRepository, useFactory: () => new AiOutputRepository(pgDb) },
    { provide: AiDlqRepository, useFactory: () => new AiDlqRepository(pgDb) },
    { provide: AiBatchRepository, useFactory: () => new AiBatchRepository(pgDb) },
    { provide: AiBackfillCursorRepository, useFactory: () => new AiBackfillCursorRepository(pgDb) },
    { provide: ForumThreadReadRepository, useFactory: () => new ForumThreadReadRepository(pgDb) },
    {
      provide: ProposalSummaryScanRepository,
      useFactory: () => new ProposalSummaryScanRepository(pgDb),
    },
    {
      provide: ProposalMismatchScanRepository,
      useFactory: () => new ProposalMismatchScanRepository(pgDb),
    },
    {
      provide: ProposalEmbeddingRepository,
      useFactory: () => new ProposalEmbeddingRepository(pgDb),
    },
    {
      provide: ProposalEmbeddingScanRepository,
      useFactory: () => new ProposalEmbeddingScanRepository(pgDb),
    },
    { provide: LLM_CLIENT, useFactory: createWorkerLlmClient },
    {
      provide: AiCompletionCache,
      useFactory: (llm: LLMClient) => new AiCompletionCache(pgDb, llm),
      inject: [LLM_CLIENT],
    },
    {
      provide: ProposalEmbeddingWriter,
      useFactory: (embeddings: ProposalEmbeddingRepository, costs: AiCostLogRepository) =>
        new ProposalEmbeddingWriter(pgDb, embeddings, costs),
      inject: [ProposalEmbeddingRepository, AiCostLogRepository],
    },
    // Durable in-flight-batch gateway (#617): the DB is the source of truth for open batches + the
    // backfill cursor, so a restart resumes them instead of orphaning a paid batch / re-walking.
    {
      provide: DurableBatch,
      useFactory: (
        llm: LLMClient,
        batches: AiBatchRepository,
        cursors: AiBackfillCursorRepository,
        outputs: AiOutputRepository,
        costs: AiCostLogRepository,
        dlq: AiDlqRepository,
      ) =>
        new DurableBatch(pgDb, llm, batches, cursors, {
          outputs,
          costs,
          dlq,
          clock: new SystemClock(),
        }),
      inject: [
        LLM_CLIENT,
        AiBatchRepository,
        AiBackfillCursorRepository,
        AiOutputRepository,
        AiCostLogRepository,
        AiDlqRepository,
      ],
    },
    ProposalSummaryAssembler,
    ProposalSummaryBatchService,
    // Real-time urgent-summary handler; self-registers with AiFeatureHandlerRegistry on init.
    ProposalSummaryHandler,
    MismatchAssembler,
    // Sync mismatch-detector handler (SPEC §5.6); self-registers with the handler registry on init.
    MismatchHandler,
    ForumSynthesisAssembler,
    // Batch-by-default forum synthesis driver (SPEC §5.7); the handler below is the urgent/forced sync
    // fallback and self-registers with the handler registry on init.
    ForumSynthesisBatchService,
    ForumSynthesisHandler,
    // Proposal-embedding handler (SPEC §5.8); self-registers with the handler registry on init.
    ProposalEmbeddingHandler,
    // Full-history backfill driver (SPEC §10.7 / M5-7.1); inert unless AI_BACKFILL_ENABLED + a per-feature
    // flag is set. Reuses the batch/sync machinery above over keyset-paginated full-history scans.
    AiBackfillConfig,
    AiBackfillService,
  ],
})
export class AppModule {}
