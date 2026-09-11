import { Injectable } from "@nestjs/common";
import { AccountStatus, Prisma, SetupStatus } from "@prisma/client";
import { conflict, notFound } from "../../common/errors/api-exception";
import { PrismaService } from "../../database/prisma.service";
import { AuthContext } from "./auth-context";
import { StaffRegistrationDto } from "./dto/staff-registration.dto";
import { AuthMeResponse, LogoutResponse, StaffRegistrationResponse } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async registerStaff(dto: StaffRegistrationDto, auth: AuthContext): Promise<StaffRegistrationResponse> {
    await this.assertSetupCompleted();

    const displayName = dto.displayName?.trim() || auth.displayName;
    const user = await this.createOrReadPendingUser(auth, displayName);

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status
      }
    };
  }

  async getMe(auth: AuthContext): Promise<AuthMeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { authUserId: auth.authUserId },
      include: {
        staffBranches: {
          where: { isActive: true },
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
          },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!user) {
      throw notFound("USER_NOT_REGISTERED", "User is not registered");
    }

    const memberships = user.staffBranches.map((membership) => {
      const roles = membership.roleAssignments.map((assignment) => assignment.role.code);
      const permissions = [
        ...new Set(
          membership.roleAssignments.flatMap((assignment) =>
            assignment.role.permissions.map((rolePermission) => rolePermission.permission.code)
          )
        )
      ].sort();

      return {
        id: membership.id,
        isPrimary: membership.isPrimary,
        isActive: membership.isActive,
        branch: {
          id: membership.branch.id,
          code: membership.branch.code,
          name: membership.branch.name,
          timezone: membership.branch.timezone
        },
        roles,
        permissions
      };
    });

    const roles = [...new Set(memberships.flatMap((membership) => membership.roles))].sort();
    const permissions = [...new Set(memberships.flatMap((membership) => membership.permissions))].sort();
    const activeBranch = memberships.find((membership) => membership.isPrimary)?.branch ?? memberships[0]?.branch ?? null;

    return {
      profile: {
        id: user.id,
        authUserId: user.authUserId,
        email: user.email,
        displayName: user.displayName,
        avatarPath: user.avatarPath
      },
      accountStatus: user.status,
      activeBranch,
      memberships,
      roles,
      permissions,
      shiftAccess: {
        current: null,
        availableActions: []
      }
    };
  }

  async logout(auth: AuthContext): Promise<LogoutResponse> {
    await this.prisma.user.updateMany({
      where: { authUserId: auth.authUserId },
      data: { lastLoginAt: new Date() }
    });
    return { handled: true, attendance: null };
  }

  private async assertSetupCompleted(): Promise<void> {
    const setup = await this.prisma.systemSetup.findUnique({ where: { id: 1 } });
    if (!setup || setup.status !== SetupStatus.COMPLETED) {
      throw conflict("SETUP_NOT_COMPLETED", "First-time setup is not completed");
    }
  }

  private async createOrReadPendingUser(auth: AuthContext, displayName: string): Promise<{
    id: string;
    email: string;
    displayName: string;
    status: AccountStatus;
  }> {
    try {
      return await this.prisma.user.upsert({
        where: { authUserId: auth.authUserId },
        create: {
          authUserId: auth.authUserId,
          email: auth.email.toLowerCase(),
          displayName,
          avatarPath: auth.avatarUrl,
          status: AccountStatus.PENDING,
          lastLoginAt: new Date()
        },
        update: {
          lastLoginAt: new Date()
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.user.findUnique({ where: { authUserId: auth.authUserId } });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }
}
