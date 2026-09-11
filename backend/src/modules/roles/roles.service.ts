import { Injectable } from "@nestjs/common";
import { AuditAction, Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { ADMIN_ROLE_CODE } from "../auth/permissions";
import { AuthorizationService } from "../auth/services/authorization.service";
import { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from "./dto/role.dto";
import { PermissionListResponse, PermissionResponse, RoleListResponse, RoleResponse } from "./roles.types";

type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: {
    permissions: {
      include: {
        permission: true;
      };
    };
  };
}>;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService
  ) {}

  async list(): Promise<RoleListResponse> {
    const roles = await this.prisma.role.findMany({
      include: this.roleInclude(),
      orderBy: [{ isSystem: "desc" }, { code: "asc" }]
    });
    return { items: roles.map((role) => this.toRoleResponse(role)) };
  }

  async create(dto: CreateRoleDto, context: BranchContext): Promise<RoleResponse> {
    const code = this.normalizeCode(dto.code);
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({
          data: {
            code,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            isSystem: false
          },
          include: this.roleInclude()
        });
        await this.auditRole(tx, context, created.id, null, this.auditSnapshot(created));
        return created;
      });
      return this.toRoleResponse(role);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("ROLE_CODE_EXISTS", "Role code already exists");
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateRoleDto, context: BranchContext): Promise<RoleResponse> {
    this.authorizationService.validateUuid(id, "INVALID_ROLE_ID");
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.role.findUnique({
        where: { id },
        include: this.roleInclude()
      });
      if (!existing) {
        throw notFound("ROLE_NOT_FOUND", "Role not found");
      }
      if (existing.isSystem && dto.code && this.normalizeCode(dto.code) !== existing.code) {
        throw forbidden("SYSTEM_ROLE_IMMUTABLE", "System role code cannot be changed");
      }
      if (dto.isSystem !== undefined && dto.isSystem !== existing.isSystem) {
        throw forbidden("SYSTEM_ROLE_IMMUTABLE", "Role system flag cannot be changed");
      }

      const updated = await tx.role.update({
        where: { id },
        data: {
          ...(dto.code && !existing.isSystem ? { code: this.normalizeCode(dto.code) } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {})
        },
        include: this.roleInclude()
      });
      await this.auditRole(tx, context, id, this.auditSnapshot(existing), this.auditSnapshot(updated));
      return this.toRoleResponse(updated);
    });
  }

  async listPermissions(): Promise<PermissionListResponse> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: { code: "asc" }
    });
    return { items: permissions.map((permission) => this.toPermissionResponse(permission)) };
  }

  async replacePermissions(id: string, dto: ReplaceRolePermissionsDto, context: BranchContext): Promise<RoleResponse> {
    this.authorizationService.validateUuid(id, "INVALID_ROLE_ID");
    const permissionIds = [...new Set(dto.permissionIds)];

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.role.findUnique({
        where: { id },
        include: this.roleInclude()
      });
      if (!existing) {
        throw notFound("ROLE_NOT_FOUND", "Role not found");
      }
      if (existing.code === ADMIN_ROLE_CODE) {
        throw forbidden("LAST_ADMIN_REQUIRED", "Administrator permissions cannot be weakened");
      }

      const permissions = await tx.permission.findMany({
        where: { id: { in: permissionIds } },
        select: { id: true }
      });
      if (permissions.length !== permissionIds.length) {
        throw badRequest("INVALID_PERMISSION_IDS", "One or more permissions do not exist");
      }

      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true
      });

      const updated = await tx.role.findUniqueOrThrow({
        where: { id },
        include: this.roleInclude()
      });
      await this.auditRole(tx, context, id, this.auditSnapshot(existing), this.auditSnapshot(updated));
      return this.toRoleResponse(updated);
    });
  }

  private roleInclude() {
    return {
      permissions: {
        include: {
          permission: true
        }
      }
    } as const;
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase().replace(/\s+/g, "_");
  }

  private toPermissionResponse(permission: { id: string; code: string; description: string | null }): PermissionResponse {
    return {
      id: permission.id,
      code: permission.code,
      description: permission.description
    };
  }

  private toRoleResponse(role: RoleWithPermissions): RoleResponse {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((rolePermission) => this.toPermissionResponse(rolePermission.permission)).sort((a, b) => a.code.localeCompare(b.code)),
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString()
    };
  }

  private auditSnapshot(role: RoleWithPermissions): Prisma.InputJsonObject {
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissionIds: role.permissions.map((rolePermission) => rolePermission.permissionId).sort()
    };
  }

  private async auditRole(
    tx: Prisma.TransactionClient,
    context: BranchContext,
    entityId: string,
    beforeData: Prisma.InputJsonValue | null,
    afterData: Prisma.InputJsonValue | null
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        branchId: context.branch.id,
        actorId: context.user.id,
        action: AuditAction.UPDATE_ROLE,
        entityType: "role",
        entityId,
        beforeData: beforeData ?? undefined,
        afterData: afterData ?? undefined,
        metadata: {
          requestId: this.requestContext.getRequestId() ?? null
        },
        requestId: this.requestContext.getRequestId()
      }
    });
  }
}
