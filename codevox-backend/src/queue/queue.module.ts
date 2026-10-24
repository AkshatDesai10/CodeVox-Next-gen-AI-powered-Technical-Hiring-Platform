import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { isRedisEnabled } from '../config/redis-enabled';
import {
  AI_DETECTION_QUEUE,
  PLAGIARISM_QUEUE,
  RESUME_SCREENING_QUEUE,
  TAKE_HOME_EVAL_QUEUE,
} from './queue.constants';

function redisConnectionFromEnv(config: ConfigService) {
  const url = config.get<string>('REDIS_URL') ?? undefined;
  return { url };
}

@Global()
@Module({})
export class QueueModule {
  static register(): DynamicModule {
    if (!isRedisEnabled()) {
      return {
        module: QueueModule,
        global: true,
      };
    }

    return {
      module: QueueModule,
      global: true,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: redisConnectionFromEnv(config),
          }),
        }),
        BullModule.registerQueue(
          { name: TAKE_HOME_EVAL_QUEUE },
          { name: PLAGIARISM_QUEUE },
          { name: AI_DETECTION_QUEUE },
          { name: RESUME_SCREENING_QUEUE },
        ),
      ],
      exports: [BullModule],
    };
  }
}
