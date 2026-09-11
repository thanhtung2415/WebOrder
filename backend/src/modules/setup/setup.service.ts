import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountStatus, AuditAction, IdempotencyStatus, Prisma, SetupStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { conflict, forbidden, unprocessable } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../database/prisma.service";
import { AuthContext } from "../auth/auth-context";
import { RbacSeedService } from "../auth/services/rbac-seed.service";
import { CompleteSetupDto } from "./dto/complete-setup.dto";
import { SetupTokenService } from "./setup-token.service";
import { CompleteSetupResponse, SetupStatusResponse } from "./setup.types";
import { stableStringify } from "./stable-json";

interface LockedSetupRow {
  id: number;
  status: SetupStatus;
  setup_token_hash: string | null;
  token_expires_at: Date | null;
  token_consumed_at: Date | null;
}

interface LockedIdempotencyRow {
  id: string;
  request_hash: string;
  response_body: Prisma.JsonValue | null;
  status: IdempotencyStatus;
}

@Injectable()
export class SetupService {
  private readonly scope = "setup.complete";

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly setupTokenService: SetupTokenService,
    private readonly requestContext: RequestContextService,
    private readonly rbacSeedService: RbacSeedService
  ) {}

  async getStatus(): Promise<SetupStatusResponse> {
    const setup = await this.ensureSetupRow();
    return { status: setup.status };
  }

  async completeSetup(dto: CompleteSetupDto, auth: AuthContext, idempotencyKey: string | undefined): Promise<CompleteSetupResponse> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw conflict("SETUP_IN_PROGRESS", "Idempotency-Key is required for setup");
    }

    const requestHash = this.hashRequest(dto);
    const key = idempotencyKey.trim();

    return this.prisma.$transaction(async (tx) => {
      await this.ensureSetupRow(tx);
      const idempotency = await this.lockOrCreateIdempotency(tx, key, requestHash);
      if (idempotency.status === IdempotencyStatus.SUCCEEDED) {
        return this.readStoredResponse(idempotency);
      }

      const setup = await this.lockSetup(tx);
      if (setup.status === SetupStatus.COMPLETED || setup.token_consumed_at) {
        throw conflict("SETUP_ALREADY_COMPLETED", "First-time setup has already been completed");
      }

      const setupTokenHash = setup.setup_token_hash ?? this.setupTokenService.hashToken(this.configService.get("SETUP_TOKEN", { infer: true }));
      if (!setup.setup_token_hash) {
        await tx.systemSetup.update({
          where: { id: 1 },
          data: { setupTokenHash }
        });
      }

      if (setup.token_expires_at && setup.token_expires_at.getTime() < Date.now()) {
        throw unprocessable("SETUP_TOKEN_EXPIRED", "Setup token has expired");
      }
      if (!this.setupTokenService.verifyToken(dto.setupToken, setupTokenHash)) {
        throw forbidden("INVALID_SETUP_TOKEN", "Setup token is invalid");
      }

      const branch = await tx.branch.create({
        data: {
          code: dto.branch.code.trim().toUpperCase(),
          name: dto.branch.name.trim(),
          timezone: dto.branch.timezone.trim()
        }
      });

      const admin = await tx.user.create({
        data: {
          authUserId: auth.authUserId,
          email: auth.email.toLowerCase(),
          displayName: dto.admin.displayName.trim(),
          avatarPath: auth.avatarUrl,
          status: AccountStatus.ACTIVE,
          lastLoginAt: new Date()
        }
      });

      const staffBranch = await tx.staffBranch.create({
        data: {
          userId: admin.id,
          branchId: branch.id,
          isPrimary: true,
          isActive: true
        }
      });

      const adminRole = await this.rbacSeedService.getAdminRole(tx);
      await tx.staffRole.create({
        data: {
          staffBranchId: staffBranch.id,
          roleId: adminRole.id
        }
      });

      await tx.auditLog.create({
        data: {
          branchId: branch.id,
          actorId: admin.id,
          action: AuditAction.FIRST_TIME_SETUP_COMPLETED,
          entityType: "system_setup",
          entityId: admin.id,
          afterData: {
            status: SetupStatus.COMPLETED,
            branchCode: branch.code,
            adminEmail: admin.email
          },
          metadata: {
            requestId: this.requestContext.getRequestId() ?? null
          },
          requestId: this.requestContext.getRequestId()
        }
      });

      await tx.systemSetup.update({
        where: { id: 1 },
        data: {
          status: SetupStatus.COMPLETED,
          tokenConsumedAt: new Date(),
          completedAt: new Date(),
          completedById: admin.id
        }
      });

      const response: CompleteSetupResponse = {
        status: "COMPLETED",
        branch: {
          id: branch.id,
          code: branch.code,
          name: branch.name,
          timezone: branch.timezone
        },
        admin: {
          id: admin.id,
          email: admin.email,
          displayName: admin.displayName,
          status: "ACTIVE"
        }
      };

      await tx.idempotencyKey.update({
        where: { id: idempotency.id },
        data: {
          status: IdempotencyStatus.SUCCEEDED,
          responseStatus: 201,
          responseBody: response as unknown as Prisma.InputJsonObject
        }
      });

      return response;
    });
  }

  private async ensureSetupRow(tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<{ status: "PENDING" | "COMPLETED" }> {
    const setupTokenHash = this.setupTokenService.hashToken(this.configService.get("SETUP_TOKEN", { infer: true }));
    await tx.$executeRaw`
      INSERT INTO system_setup (id, status, setup_token_hash, updated_at)
      VALUES (1, 'PENDING', ${setupTokenHash}, now())
      ON CONFLICT (id) DO NOTHING
    `;
    const setup = await tx.systemSetup.findUniqueOrThrow({ where: { id: 1 } });
    return { status: setup.status };
  }

  private async lockSetup(tx: Prisma.TransactionClient): Promise<LockedSetupRow> {
    const rows = await tx.$queryRaw<LockedSetupRow[]>`
      SELECT id, status, setup_token_hash, token_expires_at, token_consumed_at
      FROM system_setup
      WHERE id = 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw conflict("SETUP_IN_PROGRESS", "Setup state is unavailable");
    }
    return row;
  }

  private async lockOrCreateIdempotency(tx: Prisma.TransactionClient, key: string, requestHash: string): Promise<LockedIdempotencyRow> {
    await tx.idempotencyKey.upsert({
      where: { scope_key: { scope: this.scope, key } },
      create: {
        scope: this.scope,
        key,
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      },
      update: {}
    });

    const rows = await tx.$queryRaw<LockedIdempotencyRow[]>`
      SELECT id, request_hash, response_body, status
      FROM idempotency_keys
      WHERE scope = ${this.scope} AND key = ${key}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw conflict("SETUP_IN_PROGRESS", "Setup idempotency state is unavailable");
    }
    if (row.request_hash !== requestHash) {
      throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different payload");
    }
    return row;
  }

  private readStoredResponse(row: LockedIdempotencyRow): CompleteSetupResponse {
    if (!this.isCompleteSetupResponse(row.response_body)) {
      throw conflict("SETUP_IN_PROGRESS", "Setup result is still being finalized");
    }
    return row.response_body as unknown as CompleteSetupResponse;
  }

  private hashRequest(dto: CompleteSetupDto): string {
    return createHash("sha256").update(stableStringify(dto), "utf8").digest("hex");
  }

  private isCompleteSetupResponse(value: Prisma.JsonValue | null): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    return record.status === "COMPLETED" && typeof record.branch === "object" && typeof record.admin === "object";
  }
}
