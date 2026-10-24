import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VivaProjectReportMysql, VivaReportChunkMysql } from '../viva-erp/entities/viva-erp.mysql.entities';
import { ChunkService } from './chunk.service';
import { EmbeddingService } from './embedding.service';
import { FaissVectorStore } from './faiss-vector.store';
import { IntegrityConfigService } from './integrity.config';
import { LexicalSimilarityService } from './lexical-similarity.service';
import { PgVectorStore } from './pg-vector.store';
import { PlagiarismService } from './plagiarism.service';
import { VECTOR_STORE } from './vector-store.interface';

@Module({
  imports: [TypeOrmModule.forFeature([VivaReportChunkMysql, VivaProjectReportMysql])],
  providers: [
    IntegrityConfigService,
    ChunkService,
    EmbeddingService,
    LexicalSimilarityService,
    FaissVectorStore,
    PgVectorStore,
    {
      provide: VECTOR_STORE,
      useExisting: FaissVectorStore,
    },
    PlagiarismService,
  ],
  exports: [PlagiarismService, IntegrityConfigService, ChunkService, LexicalSimilarityService],
})
export class IntegrityModule {}
