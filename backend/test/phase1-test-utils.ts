import { AccountStatus, SetupStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/database/prisma.service";
import { AuthContext } from "../src/modules/auth/auth-context";
import { CompleteSetupDto } from "../src/modules/setup/dto/complete-setup.dto";

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs,
      staff_roles,
      role_permissions,
      permissions,
      roles,
      staff_branches,
      idempotency_keys,
      system_setup,
      users,
      branches
    RESTART IDENTITY CASCADE
  `);
}

export async function markSetupCompleted(prisma: PrismaService): Promise<void> {
  const completedBy = await prisma.user.create({
    data: {
      authUserId: randomUUID(),
      email: `completed-${randomUUID()}@example.com`,
      displayName: "Completed Setup User",
      status: AccountStatus.ACTIVE
    }
  });

  await prisma.systemSetup.create({
    data: {
      id: 1,
      status: SetupStatus.COMPLETED,
      completedAt: new Date(),
      completedById: completedBy.id,
      tokenConsumedAt: new Date()
    }
  });
}

export async function createPendingSetup(prisma: PrismaService): Promise<void> {
  await prisma.systemSetup.create({
    data: {
      id: 1,
      status: SetupStatus.PENDING
    }
  });
}

export function createAuthContext(overrides: Partial<AuthContext> = {}): AuthContext {
  const id = randomUUID();
  return {
    authUserId: id,
    email: `staff-${id}@example.com`,
    displayName: "Test Staff",
    ...overrides
  };
}

export function createSetupDto(overrides: Partial<CompleteSetupDto> = {}): CompleteSetupDto {
  return {
    setupToken: "test-setup-token",
    branch: {
      code: "MAIN",
      name: "Main Branch",
      timezone: "Asia/Ho_Chi_Minh"
    },
    admin: {
      displayName: "Owner"
    },
    ...overrides
  };
}

export async function createPendingUser(prisma: PrismaService, auth: AuthContext): Promise<void> {
  await prisma.user.create({
    data: {
      authUserId: auth.authUserId,
      email: auth.email,
      displayName: auth.displayName,
      status: AccountStatus.PENDING
    }
  });
}
