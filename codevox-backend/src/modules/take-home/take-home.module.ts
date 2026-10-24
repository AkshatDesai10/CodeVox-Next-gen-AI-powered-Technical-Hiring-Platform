import { Module } from '@nestjs/common';
import { TakeHomeOrchestratorService } from './take-home-orchestrator.service';
import { TakeHomeService } from './take-home.service';

@Module({
  providers: [TakeHomeOrchestratorService, TakeHomeService],
  exports: [TakeHomeOrchestratorService, TakeHomeService],
})
export class TakeHomeModule {}
