import { Module } from '@nestjs/common';
import { NetworkCheckController } from './network-check.controller';

@Module({
  controllers: [NetworkCheckController],
})
export class NetworkCheckModule {}
