import {
  BadRequestException,
  Injectable,
  Optional,
  type PipeTransform,
} from '@nestjs/common';

export type ParseBigIntIdPipeOptions = {
  optional?: boolean;
};

/**
 * Validates route/query params that reference MySQL BIGINT PKs (kept as string in TS).
 */
@Injectable()
export class ParseBigIntIdPipe implements PipeTransform<string, string> {
  constructor(
    @Optional() private readonly options: ParseBigIntIdPipeOptions = {},
  ) {}

  transform(value: string | undefined): string {
    if (value === undefined || value === null || value === '') {
      if (this.options?.optional) {
        return value as string;
      }
      throw new BadRequestException('Validation failed (numeric id is expected)');
    }
    const trimmed = String(value).trim();
    if (!/^\d{1,20}$/.test(trimmed)) {
      throw new BadRequestException('Validation failed (numeric id is expected)');
    }
    return trimmed;
  }
}
