import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { conflict, forbidden, notFound, unprocessable } from "../../common/errors/api-exception";
import { PrismaService } from "../../database/prisma.service";
import { BranchContext } from "../auth/branch-context";
import { AuthorizationService } from "../auth/services/authorization.service";
import { RbacSeedService } from "../auth/services/rbac-seed.service";
import { CreateBranchDto, UpdateBranchDto } from "./dto/branch.dto";
import { BranchListResponse, BranchResponse } from "./branches.types";

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly rbacSeedService: RbacSeedService
  ) {}

  async list(context: BranchContext): Promise<BranchListResponse> {
    const memberships = await this.prisma.staffBranch.findMany({
      where: {
        userId: context.user.id,
        isActive: true,
        branch: {
          deletedAt: null
        }
      },
      include: { branch: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
    });

    return {
      items: memberships.map((membership) => this.toResponse(membership.branch))
    };
  }

  async create(dto: CreateBranchDto, context: BranchContext): Promise<BranchResponse> {
    this.assertTimezone(dto.timezone);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const adminRole = await this.rbacSeedService.getAdminRole(tx);
        const branch = await tx.branch.create({
          data: {
            code: dto.code.trim().toUpperCase(),
            name: dto.name.trim(),
            timezone: dto.timezone.trim(),
            attendanceGraceMinutes: dto.attendanceGraceMinutes ?? 30,
            address: dto.address?.trim() || null,
            phone: dto.phone?.trim() || null
          }
        });

        const staffBranch = await tx.staffBranch.create({
          data: {
            userId: context.user.id,
            branchId: branch.id,
            isPrimary: false,
            isActive: true
          }
        });

        await tx.staffRole.create({
          data: {
            staffBranchId: staffBranch.id,
            roleId: adminRole.id
          }
        });

        await this.authorizationService.assertBranchStillHasActiveAdmin(tx, branch.id);
        return this.toResponse(branch);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("BRANCH_CODE_EXISTS", "Branch code already exists");
      }
      throw error;
    }
  }

  async get(id: string, context: BranchContext): Promise<BranchResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BRANCH_ID");
    if (id !== context.branch.id) {
      throw forbidden("BRANCH_ACCESS_DENIED", "User does not have access to this branch");
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id, deletedAt: null }
    });
    if (!branch) {
      throw notFound("BRANCH_NOT_FOUND", "Branch not found");
    }
    return this.toResponse(branch);
  }

  async update(id: string, dto: UpdateBranchDto, context: BranchContext): Promise<BranchResponse> {
    this.authorizationService.validateUuid(id, "INVALID_BRANCH_ID");
    if (id !== context.branch.id) {
      throw forbidden("BRANCH_ACCESS_DENIED", "User does not have access to this branch");
    }
    if (dto.timezone) {
      this.assertTimezone(dto.timezone);
    }

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone.trim() } : {}),
        ...(dto.attendanceGraceMinutes !== undefined ? { attendanceGraceMinutes: dto.attendanceGraceMinutes } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {})
      }
    });

    return this.toResponse(branch);
  }

  private assertTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      throw unprocessable("INVALID_TIMEZONE", "Timezone must be a valid IANA timezone");
    }
  }

  private toResponse(branch: {
    id: string;
    code: string;
    name: string;
    timezone: string;
    attendanceGraceMinutes: number;
    address: string | null;
    phone: string | null;
    status: BranchResponse["status"];
    createdAt: Date;
    updatedAt: Date;
  }): BranchResponse {
    return {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      timezone: branch.timezone,
      attendanceGraceMinutes: branch.attendanceGraceMinutes,
      address: branch.address,
      phone: branch.phone,
      status: branch.status,
      createdAt: branch.createdAt.toISOString(),
      updatedAt: branch.updatedAt.toISOString()
    };
  }
}
