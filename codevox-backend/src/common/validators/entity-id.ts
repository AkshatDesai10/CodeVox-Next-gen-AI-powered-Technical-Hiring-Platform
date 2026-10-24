import { Matches, type ValidationOptions } from 'class-validator';

/** MySQL BIGINT ids (stringified) or legacy PostgreSQL UUIDs. */
export const ENTITY_ID_PATTERN =
  /^(\d{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function IsEntityId(options?: ValidationOptions) {
  return Matches(ENTITY_ID_PATTERN, {
    message: 'must be a numeric id or UUID',
    ...options,
  });
}

export function IsEntityIdEach(options?: ValidationOptions) {
  return Matches(ENTITY_ID_PATTERN, {
    each: true,
    message: 'each value must be a numeric id or UUID',
    ...options,
  });
}
