import { Injectable } from '@nestjs/common';
import type {
  ExecutionStrategy,
  ExecutionType,
  Question,
} from './execution-strategy';
import { resolveExecutionType } from './resolve-execution-type.util';
import { ScriptStrategy } from './strategies/script.strategy';
import { HttpServiceStrategy } from './strategies/http-service.strategy';
import { FrameworkProjectStrategy } from './strategies/framework-project.strategy';
import { DatabaseOnlyStrategy } from './strategies/database-only.strategy';

@Injectable()
export class StrategyRegistry {
  private readonly strategies: ExecutionStrategy[];

  constructor() {
    this.strategies = [
      new ScriptStrategy(),
      new HttpServiceStrategy(),
      new FrameworkProjectStrategy(),
      new DatabaseOnlyStrategy(),
    ];
  }

  get(executionType: ExecutionType): ExecutionStrategy {
    const strategy = this.strategies.find((s) => s.executionType === executionType);
    if (!strategy) {
      return this.strategies.find((s) => s.executionType === 'SCRIPT')!;
    }
    return strategy;
  }

  resolve(question: Question, language: string, sampleInput?: string, sourceCode?: string): ExecutionStrategy {
    const executionType = resolveExecutionType(question, language, sampleInput, sourceCode);
    return this.get(executionType);
  }

  /** For BullMQ routing — map strategy to queue weight tier. */
  resourceWeightFor(question: Question, language: string, sampleInput?: string, sourceCode?: string) {
    return this.resolve(question, language, sampleInput, sourceCode).resourceWeight;
  }

  list(): ExecutionStrategy[] {
    return [...this.strategies];
  }
}
