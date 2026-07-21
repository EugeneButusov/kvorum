import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  AiCompletionCache,
  AiCostLogRepository,
  AiDlqRepository,
  AiJobDlqRepository,
  AiOutputRepository,
  type LLMClient,
} from '@libs/ai';
import { ProposalReadRepository, ProposalRepository, pgDb } from '@libs/db';
import { OpsServer } from '@nest/observability';
import { ShutdownLogger } from './shutdown-logger';
import { AiBudgetCapService } from '../budget/ai-budget-cap.service';
import { AiBudgetState } from '../budget/ai-budget-state';
import { AiFeatureHandlerRegistry } from '../consumer/ai-feature-handler.registry';
import { AiJobDlqBridge } from '../consumer/ai-job-dlq.bridge';
import { AiJobConsumer } from '../consumer/ai-job.consumer';
import { LLM_CLIENT, createWorkerLlmClient } from '../llm/llm.provider';
import { AiQueueMetricsService } from '../metrics/ai-queue-metrics.service';
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
    { provide: LLM_CLIENT, useFactory: createWorkerLlmClient },
    {
      provide: AiCompletionCache,
      useFactory: (llm: LLMClient) => new AiCompletionCache(pgDb, llm),
      inject: [LLM_CLIENT],
    },
    ProposalSummaryAssembler,
    ProposalSummaryBatchService,
    // Real-time urgent-summary handler; self-registers with AiFeatureHandlerRegistry on init.
    ProposalSummaryHandler,
  ],
})
export class AppModule {}
