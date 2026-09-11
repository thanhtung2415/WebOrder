import { Injectable, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { ADMIN_ROLE_CODE, DEFAULT_ROLE_LABELS, DEFAULT_ROLE_PERMISSIONS, DEFAULT_SYSTEM_ROLES, PERMISSION_CODES, SystemRoleCode } from "../permissions";

@Injectable()
export class RbacSeedService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (!this.hasRbacDelegates(this.prisma)) {
      return;
    }
    await this.ensureDefaults();
  }

  async ensureDefaults(tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Record<SystemRoleCode, { id: string }>> {
    await tx.permission.createMany({
      data: PERMISSION_CODES.map((code) => ({ code, description: `${code} permission` })),
      skipDuplicates: true
    });

    const roleEntries = await Promise.all(
      DEFAULT_SYSTEM_ROLES.map(async (code) => {
        const labels = DEFAULT_ROLE_LABELS[code];
        const role = await tx.role.upsert({
          where: { code },
          create: {
            code,
            name: labels.name,
            description: labels.description,
            isSystem: true
          },
          update: {
            isSystem: true
          },
          select: { id: true, code: true }
        });
        return [role.code as SystemRoleCode, { id: role.id }] as const;
      })
    );

    const permissions = await tx.permission.findMany({
      where: { code: { in: [...PERMISSION_CODES] } },
      select: { id: true, code: true }
    });
    const permissionIdsByCode = new Map(permissions.map((permission) => [permission.code, permission.id]));

    for (const [code, role] of roleEntries) {
      const permissionIds = DEFAULT_ROLE_PERMISSIONS[code]
        .map((permissionCode) => permissionIdsByCode.get(permissionCode))
        .filter((permissionId): permissionId is string => Boolean(permissionId));

      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId
        })),
        skipDuplicates: true
      });
    }

    return Object.fromEntries(roleEntries) as Record<SystemRoleCode, { id: string }>;
  }

  async getAdminRole(tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<{ id: string }> {
    const roles = await this.ensureDefaults(tx);
    return roles[ADMIN_ROLE_CODE];
  }

  private hasRbacDelegates(value: PrismaService): boolean {
    const candidate = value as { permission?: unknown; role?: unknown; rolePermission?: unknown };
    return Boolean(candidate.permission && candidate.role && candidate.rolePermission);
  }
}
