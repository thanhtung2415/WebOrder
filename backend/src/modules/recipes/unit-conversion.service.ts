import { Injectable } from "@nestjs/common";
import { Prisma, Unit, UnitDimension } from "@prisma/client";
import { badRequest, unprocessable } from "../../common/errors/api-exception";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class UnitConversionService {
  constructor(private readonly prisma: PrismaService) {}

  async convertToBaseUnit(ingredientId: string, fromUnitId: string, quantity: Prisma.Decimal.Value): Promise<Prisma.Decimal> {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id: ingredientId, deletedAt: null },
      select: { baseUnitId: true }
    });
    if (!ingredient) {
      throw badRequest("INGREDIENT_NOT_FOUND", "Ingredient not found");
    }
    const decimal = this.positiveDecimal(quantity, "INVALID_UNIT_CONVERSION", 3);
    if (fromUnitId === ingredient.baseUnitId) {
      return decimal;
    }
    const conversion = await this.prisma.unitConversion.findFirst({
      where: { ingredientId, fromUnitId, toUnitId: ingredient.baseUnitId, isActive: true }
    });
    if (!conversion) {
      throw unprocessable("INVALID_UNIT_CONVERSION", "Active conversion to the ingredient base unit is required");
    }
    return decimal.mul(conversion.conversionFactor);
  }

  positiveDecimal(value: Prisma.Decimal.Value, code: string, maxDecimalPlaces: number): Prisma.Decimal {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > maxDecimalPlaces) {
      throw unprocessable(code, "Value must be positive and use the allowed decimal precision");
    }
    return decimal;
  }

  assertCompatibleDimensions(from: Unit, to: Unit): void {
    if (from.dimension === to.dimension || from.dimension === UnitDimension.PACKAGE || to.dimension === UnitDimension.PACKAGE) {
      return;
    }
    throw unprocessable("INVALID_UNIT_CONVERSION", "Unit conversion dimensions are not compatible");
  }
}

