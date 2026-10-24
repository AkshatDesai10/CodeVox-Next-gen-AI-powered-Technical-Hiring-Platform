import { Injectable } from '@nestjs/common';
import type { EvaluationStrategy } from './interfaces';
import { EvaluationStrategyType } from './enums';

@Injectable()
export class EvaluationPluginRegistry {
  private readonly plugins = new Map<EvaluationStrategyType, EvaluationStrategy>();

  register(type: EvaluationStrategyType, strategy: EvaluationStrategy) {
    this.plugins.set(type, strategy);
  }

  get(type: EvaluationStrategyType) {
    return this.plugins.get(type);
  }
}
