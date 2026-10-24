import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiDetectionController } from './ai-detection.controller';
import { AiDetectionService } from './ai-detection.service';
import { AiContentDetectionService } from './ai-content-detection.service';
import { DeepFlagClient } from './deepflag.client';
import { DebertaInstructDetectorClient } from './deberta-instruct-detector.client';
import { TransformerDetectionClient } from './transformer-detection.client';
import { AiDetectionReportMysql } from './entities/ai-detection-report.mysql.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiDetectionReportMysql])],
  controllers: [AiDetectionController],
  providers: [
    AiDetectionService,
    AiContentDetectionService,
    DeepFlagClient,
    TransformerDetectionClient,
    DebertaInstructDetectorClient,
  ],
  exports: [AiDetectionService, AiContentDetectionService, DeepFlagClient],
})
export class AiDetectionModule {}
