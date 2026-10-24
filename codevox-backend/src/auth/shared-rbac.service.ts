import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type AppUserRow = {
  id: string;
  email: string;
  name: string | null;
  keycloakId: string | null;
  privId: string | null;
};

export type KeycloakProvisionClaims = {
  keycloakSub: string;
  email: string;
  name?: string | null;
  /** Unique staff ADMNO → stored as `users.privId`. */
  admno: string;
  brId?: string | number | null;
  userType?: string | null;
  clientIds?: string[] | null;
};

export type LocalUserProvisionClaims = {
  /** Stored in `users.keycloakId` (no real Keycloak sub required). */
  localId: string;
  email: string;
  name?: string | null;
  admno: string;
};

/**
 * Resolve app user + permission keys from the shared MySQL schema
 * (same `users` / `user_roles` / `permissions` tables as the main backend).
 */
@Injectable()
export class SharedRbacService {
  private readonly logger = new Logger(SharedRbacService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  async findUserByKeycloakOrEmail(
    keycloakSub: string,
    email: string,
  ): Promise<AppUserRow | null> {
    const rows = (await this.ds.query(
      `SELECT id, email, name, keycloakId, privId
       FROM users
       WHERE inactive = 0
         AND (
           (keycloakId IS NOT NULL AND keycloakId = ?)
           OR LOWER(email) = ?
         )
       ORDER BY (keycloakId = ?) DESC
       LIMIT 1`,
      [keycloakSub, email.toLowerCase(), keycloakSub],
    )) as AppUserRow[];
    return rows[0] ?? null;
  }

  async findUserByAdmno(admno: string): Promise<AppUserRow | null> {
    const rows = (await this.ds.query(
      `SELECT id, email, name, keycloakId, privId
       FROM users
       WHERE inactive = 0
         AND privId IS NOT NULL
         AND privId = ?
       LIMIT 1`,
      [admno],
    )) as AppUserRow[];
    return rows[0] ?? null;
  }

  /**
   * Provision/load a local-auth admin user (reuses keycloakId column for localId).
   */
  async findOrCreateLocalUser(
    claims: LocalUserProvisionClaims,
  ): Promise<AppUserRow> {
    return this.findOrCreateFromKeycloak({
      keycloakSub: claims.localId,
      email: claims.email,
      name: claims.name,
      admno: claims.admno,
    });
  }

  /**
   * Find existing user (keycloakId / email / ADMNO) or create one.
   * ADMNO is unique and stored in `users.privId`.
   */
  async findOrCreateFromKeycloak(
    claims: KeycloakProvisionClaims,
  ): Promise<AppUserRow> {
    const admno = String(claims.admno ?? '').trim();
    if (!admno) {
      throw new UnauthorizedException('Token missing admno (unique staff id)');
    }

    const email = claims.email.trim().toLowerCase();
    const keycloakSub = String(claims.keycloakSub).trim();
    const name = (claims.name ?? email).trim() || email;
    const branchId =
      claims.brId !== undefined && claims.brId !== null && String(claims.brId).trim()
        ? String(claims.brId).trim()
        : null;
    const userType = (claims.userType ?? 'staff').trim() || 'staff';
    const clientIdsJson =
      claims.clientIds && claims.clientIds.length
        ? JSON.stringify(claims.clientIds)
        : null;

    let user =
      (await this.findUserByAdmno(admno)) ??
      (await this.findUserByKeycloakOrEmail(keycloakSub, email));

    if (user) {
      const existingPriv = String(user.privId ?? '').trim();
      // Never steal another ADMNO; only set privId when empty or already this admno.
      const privIdToStore =
        !existingPriv || existingPriv === admno ? admno : existingPriv;

      if (existingPriv && existingPriv !== admno) {
        this.logger.warn(
          `User id=${user.id} email=${email} has privId=${existingPriv} but token admno=${admno}; keeping existing privId`,
        );
      }

      await this.ds.query(
        `UPDATE users
         SET keycloakId = ?,
             email = ?,
             name = ?,
             privId = ?,
             userType = COALESCE(?, userType),
             branchId = COALESCE(?, branchId),
             clientIds = COALESCE(CAST(? AS JSON), clientIds),
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND inactive = 0`,
        [
          keycloakSub,
          email,
          name,
          privIdToStore,
          userType,
          branchId,
          clientIdsJson,
          user.id,
        ],
      );
      return {
        id: String(user.id),
        email,
        name,
        keycloakId: keycloakSub,
        privId: privIdToStore,
      };
    }

    const nextIdRows = (await this.ds.query(
      `SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM users`,
    )) as Array<{ nextId: number | string }>;
    const nextId = String(nextIdRows[0]?.nextId ?? '1');

    try {
      await this.ds.query(
        `INSERT INTO users (
           id, email, name, keycloakId, userType, branchId, clientIds, privId, inactive
         ) VALUES (
           ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, 0
         )`,
        [
          nextId,
          email,
          name,
          keycloakSub,
          userType,
          branchId,
          clientIdsJson,
          admno,
        ],
      );
      this.logger.log(`Provisioned users row id=${nextId} admno=${admno} email=${email}`);
    } catch (err: unknown) {
      // Race: another request created the same ADMNO / email — re-select.
      const again =
        (await this.findUserByAdmno(admno)) ??
        (await this.findUserByKeycloakOrEmail(keycloakSub, email));
      if (again) {
        return {
          id: String(again.id),
          email: again.email,
          name: again.name,
          keycloakId: again.keycloakId,
          privId: again.privId,
        };
      }
      throw err;
    }

    await this.assignDefaultRoleIfConfigured(nextId);

    return {
      id: nextId,
      email,
      name,
      keycloakId: keycloakSub,
      privId: admno,
    };
  }

  private async assignDefaultRoleIfConfigured(userId: string): Promise<void> {
    const roleKey = (
      this.config.get<string>('RBAC_DEFAULT_ROLE_KEY') ?? 'admin'
    ).trim();
    if (!roleKey) return;

    const roles = (await this.ds.query(
      `SELECT id FROM roles WHERE \`key\` = ? AND inactive = 0 LIMIT 1`,
      [roleKey],
    )) as Array<{ id: number | string }>;
    const roleId = roles[0]?.id;
    if (!roleId) {
      this.logger.warn(
        `RBAC_DEFAULT_ROLE_KEY=${roleKey} not found in roles — user ${userId} created without role`,
      );
      return;
    }

    const existing = (await this.ds.query(
      `SELECT id FROM user_roles
       WHERE userId = ? AND roleId = ? AND inactive = 0
       LIMIT 1`,
      [userId, roleId],
    )) as Array<{ id: number }>;
    if (existing[0]) return;

    await this.ds.query(
      `INSERT INTO user_roles (userId, roleId, inactive) VALUES (?, ?, 0)`,
      [userId, roleId],
    );
    this.logger.log(`Assigned role ${roleKey} (id=${roleId}) to user ${userId}`);
  }

  private async queryWithReconnect(sql: string, params: unknown[]): Promise<unknown> {
    try {
      return await this.ds.query(sql, params);
    } catch (error) {
      const code = (error as { code?: string; driverError?: { code?: string } })?.driverError
        ?.code ?? (error as { code?: string })?.code;
      if (code !== 'ECONNRESET' && code !== 'PROTOCOL_CONNECTION_LOST') throw error;
      this.logger.warn('MySQL connection dropped; retrying the permission query once');
      return this.ds.query(sql, params);
    }
  }

  async getPermissionKeysForUserId(userId: string): Promise<string[]> {
    const rows = (await this.queryWithReconnect(
      `SELECT DISTINCT p.\`key\` AS permissionKey
       FROM user_roles ur
       INNER JOIN role_permissions rp
         ON rp.roleId = ur.roleId AND rp.inactive = 0
       INNER JOIN permissions p
         ON p.id = rp.permissionId AND p.inactive = 0
       WHERE ur.userId = ? AND ur.inactive = 0`,
      [userId],
    )) as Array<{ permissionKey: string }>;
    return rows
      .map((r) => String(r.permissionKey ?? '').trim())
      .filter(Boolean);
  }
}
