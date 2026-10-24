export type JwtUserPayload = {
  /** Internal CCTV user id (string). */
  sub: string;
  email: string;
  name?: string;
  /** Local auth subject id (stored in users.keycloakId column). */
  localSub?: string;
  /** @deprecated Prefer localSub; kept for older callers. */
  keycloakSub?: string;
  /** Explicit permission keys for this token. */
  permissions?: string[];
};
