import { Injectable } from "@nestjs/common";
import { AccountStatus, Prisma } from "@prisma/client";
import { badRequest, forbidden, notFound } from "../../../common/errors/api-exception";
import { PrismaService } from "../../../database/prisma.service";
import { AuthContext } from "../auth-context";
import { BranchContext } from "../branch-context";
import { PermissionCode } from "../permissions";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  validateUuid(value: string, code = "INVALID_UUID"): void {
    if (!uuidPattern.test(value)) {
      throw badRequest(code, "Invalid UUID");
    }
  }

  async resolveBranchContext(auth: AuthContext, branchId: string): Promise<BranchContext> {
    this.validateUuid(branchId, "INVALID_BRANCH_ID");

    const user = await this.prisma.user.findUnique({
      where: { authUserId: auth.authUserId },
      include: {
        staffBranches: {
          where: { branchId },
          include: {
            branch: true,
            roleAssignments: {
              include: {
                role: {
                  include: {
                    permissions: {
                      include: {
                        permission: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      throw notFound("USER_NOT_REGISTERED", "User is not registered");
    }
    this.assertActiveAccount(user.status);

    const membership = user.staffBranches[0];
    if (!membership || !membership.isActive || membership.branch.status !== "ACTIVE" || membership.branch.deletedAt) {
      throw forbidden("BRANCH_ACCESS_DENIED", "User does not have access to this branch");
    }

    const roles = [...new Set(membership.roleAssignments.map((assignment) => assignment.role.code))].sort();
    const permissions = [
      ...new Set(
        membership.roleAssignments.flatMap((assignment) =>
          assignment.role.permissions.map((rolePermission) => rolePermission.permission.code)
        )
      )
    ].sort();

    return {
      auth,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status
      },
      branch: {
        id: membership.branch.id,
        code: membership.branch.code,
        name: membership.branch.name,
        timezone: membership.branch.timezone,
        status: membership.branch.status
      },
      staffBranch: {
        id: membership.id,
        isPrimary: membership.isPrimary,
        isActive: membership.isActive
      },
      roles,
      permissions
    };
  }

  assertPermissions(context: BranchContext, required: readonly PermissionCode[]): void {
    const granted = new Set(context.permissions);
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      throw forbidden("FORBIDDEN", "Permission denied");
    }
  }

  assertActiveAccount(status: AccountStatus): void {
    if (status === AccountStatus.PENDING) {
      throw forbidden("ACCOUNT_PENDING", "Account is pending approval");
    }
    if (status === AccountStatus.LOCKED) {
      throw forbidden("ACCOUNT_LOCKED", "Account is locked");
    }
    if (status === AccountStatus.REJECTED) {
      throw forbidden("ACCOUNT_REJECTED", "Account is rejected");
    }
    if (status === AccountStatus.INACTIVE) {
      throw forbidden("ACCOUNT_INACTIVE", "Account is inactive");
    }
  }

  async lockLastAdminInvariant(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`last-admin:${branchId}`}))`;
  }

  async countActiveAdmins(tx: Prisma.TransactionClient | PrismaService, branchId: string): Promise<number> {
    const adminRows = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT u.id)::bigint AS count
      FROM users u
      JOIN staff_branches sb ON sb.user_id = u.id
      JOIN staff_roles sr ON sr.staff_branch_id = sb.id
      JOIN roles r ON r.id = sr.role_id
      WHERE sb.branch_id = ${branchId}::uuid
        AND sb.is_active = true
        AND u.status = 'ACTIVE'
        AND r.code = 'ADMIN'
    `;
    return Number(adminRows[0]?.count ?? 0n);
  }

  async assertBranchStillHasActiveAdmin(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    const count = await this.countActiveAdmins(tx, branchId);
    if (count < 1) {
      throw forbidden("LAST_ADMIN_REQUIRED", "At least one active administrator is required");
    }
  }
}
