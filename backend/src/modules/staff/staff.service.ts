import { Injectable } from "@nestjs/common";
import { AccountStatus, AuditAction, Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors/api-exception";
import { RequestContextService } from "../../common/request-context/request-context.service";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { ADMIN_ROLE_CODE } from "../auth/permissions";
import { AuthorizationService } from "../auth/services/authorization.service";
import { ApproveStaffDto, ChangeStaffStatusDto, RejectStaffDto, ReplaceStaffRolesDto, StaffListQueryDto } from "./dto/staff.dto";
import { StaffListResponse, StaffResponse } from "./staff.types";

type StaffWithBranch = Prisma.UserGetPayload<{
  include: {
    staffBranches: {
      include: {
        branch: true;
        roleAssignments: {
          include: {
            role: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly requestContext: RequestContextService
  ) {}

  async list(query: StaffListQueryDto, context: BranchContext): Promise<StaffListResponse> {
    const page = this.parsePositiveInt(query.page, 1);
    const pageSize = Math.min(this.parsePositiveInt(query.pageSize, 20), 100);
    const where = this.buildListWhere(query, context.branch.id);

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: this.staffInclude(context.branch.id),
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.user.count({ where })
    ]);

    return {
      items: items.map((staff) => this.toResponse(staff)),
      pagination: { page, pageSize, total }
    };
  }

  async get(id: string, context: BranchContext): Promise<StaffResponse> {
    this.authorizationService.validateUuid(id, "INVALID_STAFF_ID");
    const staff = await this.prisma.user.findUnique({
      where: { id },
      include: this.staffInclude(context.branch.id)
    });
    if (!staff) {
      throw notFound("STAFF_NOT_FOUND", "Staff not found");
    }
    if (staff.staffBranches.length === 0) {
      const membershipCount = await this.prisma.staffBranch.count({ where: { userId: id } });
      if (staff.status === AccountStatus.PENDING && membershipCount === 0) {
        return this.toResponse(staff);
      }
      throw forbidden("BRANCH_ACCESS_DENIED", "User does not have access to this branch");
    }
    return this.toResponse(staff);
  }

  async approve(id: string, dto: ApproveStaffDto, context: BranchContext): Promise<StaffResponse> {
    this.authorizationService.validateUuid(id, "INVALID_STAFF_ID");
    const roleIds = this.uniqueIds(dto.roleIds);

    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      if (user.status !== AccountStatus.PENDING) {
        throw conflict("INVALID_ACCOUNT_TRANSITION", "Only pending staff can be approved");
      }

      const roles = await this.findRolesOrThrow(tx, roleIds);
      const staffBranch = await tx.staffBranch.upsert({
        where: {
          userId_branchId: {
            userId: user.id,
            branchId: context.branch.id
          }
        },
        create: {
          userId: user.id,
          branchId: context.branch.id,
          employeeCode: dto.employeeCode?.trim() || null,
          isPrimary: true,
          isActive: true
        },
        update: {
          employeeCode: dto.employeeCode?.trim() || undefined,
          isActive: true
        }
      });

      await this.replaceRoles(tx, staffBranch.id, roleIds);
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { status: AccountStatus.ACTIVE }
      });

      await this.writeAudit(tx, context, AuditAction.APPROVE_USER, user.id, { status: user.status }, { status: updated.status, roleIds, roleCodes: roles.map((role) => role.code) }, null);
      return this.readStaffOrThrow(tx, user.id, context.branch.id);
    });
  }

  async reject(id: string, dto: RejectStaffDto, context: BranchContext): Promise<StaffResponse> {
    this.authorizationService.validateUuid(id, "INVALID_STAFF_ID");
    const reason = dto.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      if (user.status !== AccountStatus.PENDING) {
        throw conflict("INVALID_ACCOUNT_TRANSITION", "Only pending staff can be rejected");
      }
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { status: AccountStatus.REJECTED }
      });
      await this.writeAudit(tx, context, AuditAction.REJECT_USER, user.id, { status: user.status }, { status: updated.status }, reason);
      return this.toResponse({ ...updated, staffBranches: [] });
    });
  }

  async changeStatus(id: string, dto: ChangeStaffStatusDto, context: BranchContext): Promise<StaffResponse> {
    this.authorizationService.validateUuid(id, "INVALID_STAFF_ID");
    if (dto.status !== AccountStatus.ACTIVE && dto.status !== AccountStatus.LOCKED && dto.status !== AccountStatus.INACTIVE) {
      throw badRequest("INVALID_ACCOUNT_STATUS", "Unsupported account status");
    }
    if ((dto.status === AccountStatus.LOCKED || dto.status === AccountStatus.INACTIVE) && !dto.reason?.trim()) {
      throw badRequest("REASON_REQUIRED", "Reason is required");
    }

    return this.prisma.$transaction(async (tx) => {
      await this.authorizationService.lockLastAdminInvariant(tx, context.branch.id);
      const user = await this.lockUser(tx, id);
      const targetMembership = await this.lockMembership(tx, id, context.branch.id);
      const targetIsAdmin = targetMembership.roleAssignments.some((assignment) => assignment.role.code === ADMIN_ROLE_CODE);
      if (targetIsAdmin && user.status === AccountStatus.ACTIVE && dto.status !== AccountStatus.ACTIVE) {
        const admins = await this.authorizationService.countActiveAdmins(tx, context.branch.id);
        if (admins <= 1) {
          throw forbidden("LAST_ADMIN_REQUIRED", "At least one active administrator is required");
        }
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: { status: dto.status }
      });

      await this.writeAudit(
        tx,
        context,
        dto.status === AccountStatus.ACTIVE ? AuditAction.UNLOCK_USER : AuditAction.LOCK_USER,
        user.id,
        { status: user.status },
        { status: updated.status },
        dto.reason?.trim() ?? null
      );
      await this.authorizationService.assertBranchStillHasActiveAdmin(tx, context.branch.id);
      return this.readStaffOrThrow(tx, user.id, context.branch.id);
    });
  }

  async replaceStaffRoles(id: string, branchId: string, dto: ReplaceStaffRolesDto, context: BranchContext): Promise<StaffResponse> {
    this.authorizationService.validateUuid(id, "INVALID_STAFF_ID");
    this.authorizationService.validateUuid(branchId, "INVALID_BRANCH_ID");
    if (branchId !== context.branch.id) {
      throw forbidden("BRANCH_ACCESS_DENIED", "User does not have access to this branch");
    }
    const roleIds = this.uniqueIds(dto.roleIds);

    return this.prisma.$transaction(async (tx) => {
      await this.authorizationService.lockLastAdminInvariant(tx, branchId);
      const targetMembership = await this.lockMembership(tx, id, branchId);
      const beforeRoleIds = targetMembership.roleAssignments.map((assignment) => assignment.roleId);
      const beforeAdmin = targetMembership.roleAssignments.some((assignment) => assignment.role.code === ADMIN_ROLE_CODE);
      const roles = await this.findRolesOrThrow(tx, roleIds);
      const afterAdmin = roles.some((role) => role.code === ADMIN_ROLE_CODE);

      if (beforeAdmin && !afterAdmin) {
        const admins = await this.authorizationService.countActiveAdmins(tx, branchId);
        if (admins <= 1) {
          throw forbidden("LAST_ADMIN_REQUIRED", "At least one active administrator is required");
        }
      }

      await this.replaceRoles(tx, targetMembership.id, roleIds);
      await this.writeAudit(tx, context, AuditAction.UPDATE_ROLE, id, { roleIds: beforeRoleIds }, { roleIds, roleCodes: roles.map((role) => role.code) }, null);
      await this.authorizationService.assertBranchStillHasActiveAdmin(tx, branchId);
      return this.readStaffOrThrow(tx, id, branchId);
    });
  }

  private buildListWhere(query: StaffListQueryDto, branchId: string): Prisma.UserWhereInput {
    const branchScopedStaff: Prisma.UserWhereInput = {
      staffBranches: {
        some: {
          branchId,
          ...(query.role ? { roleAssignments: { some: { role: { code: query.role.trim().toUpperCase() } } } } : {})
        }
      }
    };
    const pendingUnassignedStaff: Prisma.UserWhereInput = {
      status: AccountStatus.PENDING,
      staffBranches: { none: {} }
    };
    const filters: Prisma.UserWhereInput[] = [query.role ? branchScopedStaff : { OR: [branchScopedStaff, pendingUnassignedStaff] }];
    if (query.status) {
      filters.push({ status: query.status });
    }
    if (query.q) {
      filters.push({
        OR: [
          { email: { contains: query.q, mode: "insensitive" } },
          { displayName: { contains: query.q, mode: "insensitive" } }
        ]
      });
    }

    return {
      AND: filters
    };
  }

  private staffInclude(branchId: string) {
    return {
      staffBranches: {
        where: { branchId },
        include: {
          branch: true,
          roleAssignments: {
            include: { role: true },
            orderBy: { assignedAt: "asc" as const }
          }
        },
        orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }]
      }
    };
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string): Promise<{ id: string; status: AccountStatus }> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: AccountStatus }>>`
      SELECT id, status
      FROM users
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;
    const user = rows[0];
    if (!user) {
      throw notFound("STAFF_NOT_FOUND", "Staff not found");
    }
    return user;
  }

  private async lockMembership(tx: Prisma.TransactionClient, userId: string, branchId: string) {
    await tx.$queryRaw`
      SELECT id
      FROM staff_branches
      WHERE user_id = ${userId}::uuid AND branch_id = ${branchId}::uuid
      FOR UPDATE
    `;

    const membership = await tx.staffBranch.findUnique({
      where: { userId_branchId: { userId, branchId } },
      include: {
        roleAssignments: {
          include: { role: true }
        }
      }
    });
    if (!membership || !membership.isActive) {
      throw notFound("STAFF_NOT_FOUND", "Staff branch membership not found");
    }
    return membership;
  }

  private async findRolesOrThrow(tx: Prisma.TransactionClient, roleIds: string[]): Promise<Array<{ id: string; code: string }>> {
    const roles = await tx.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, code: true }
    });
    if (roles.length !== roleIds.length) {
      throw badRequest("INVALID_ROLE_IDS", "One or more roles do not exist");
    }
    return roles;
  }

  private async replaceRoles(tx: Prisma.TransactionClient, staffBranchId: string, roleIds: string[]): Promise<void> {
    await tx.staffRole.deleteMany({ where: { staffBranchId } });
    await tx.staffRole.createMany({
      data: roleIds.map((roleId) => ({ staffBranchId, roleId })),
      skipDuplicates: true
    });
  }

  private async readStaffOrThrow(tx: Prisma.TransactionClient, id: string, branchId: string): Promise<StaffResponse> {
    const staff = await tx.user.findUnique({
      where: { id },
      include: this.staffInclude(branchId)
    });
    if (!staff) {
      throw notFound("STAFF_NOT_FOUND", "Staff not found");
    }
    return this.toResponse(staff);
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    context: BranchContext,
    action: AuditAction,
    entityId: string,
    beforeData: Prisma.InputJsonValue,
    afterData: Prisma.InputJsonValue,
    reason: string | null
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        branchId: context.branch.id,
        actorId: context.user.id,
        action,
        entityType: "user",
        entityId,
        beforeData,
        afterData,
        metadata: {
          reason,
          requestId: this.requestContext.getRequestId() ?? null
        },
        requestId: this.requestContext.getRequestId()
      }
    });
  }

  private parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private uniqueIds(ids: string[]): string[] {
    return [...new Set(ids)];
  }

  private toResponse(staff: StaffWithBranch): StaffResponse {
    return {
      id: staff.id,
      email: staff.email,
      displayName: staff.displayName,
      avatarPath: staff.avatarPath,
      status: staff.status,
      createdAt: staff.createdAt.toISOString(),
      updatedAt: staff.updatedAt.toISOString(),
      branches: staff.staffBranches.map((membership) => ({
        id: membership.id,
        branch: {
          id: membership.branch.id,
          code: membership.branch.code,
          name: membership.branch.name
        },
        employeeCode: membership.employeeCode,
        isPrimary: membership.isPrimary,
        isActive: membership.isActive,
        roles: membership.roleAssignments.map((assignment) => ({
          id: assignment.role.id,
          code: assignment.role.code,
          name: assignment.role.name
        }))
      }))
    };
  }
}
