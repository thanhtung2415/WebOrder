import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { invalidToken } from "../../common/errors/api-exception";
import { CartAccessContext, CartResponse } from "./cart.types";
import { CartService } from "./cart.service";
import { CreateCartItemDto, UpdateCartItemDto } from "./dto/cart.dto";
import { CartAccessGuard } from "./guards/cart-access.guard";

@ApiTags("cart")
@ApiBearerAuth()
@Controller("cart")
@UseGuards(CartAccessGuard)
@Throttle({ default: { ttl: 60000, limit: 240 } })
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@Req() request: Request, @Headers("x-cart-token") cartToken: string | undefined, @Headers("x-table-session-id") tableSessionId: string | undefined): Promise<CartResponse> {
    return this.cartService.getCart(this.requireAccess(request), this.normalizeHeader(cartToken), this.normalizeHeader(tableSessionId));
  }

  @Post("items")
  addItem(@Req() request: Request, @Headers("x-cart-token") cartToken: string | undefined, @Headers("x-table-session-id") tableSessionId: string | undefined, @Body() dto: CreateCartItemDto): Promise<CartResponse> {
    return this.cartService.addItem(this.requireAccess(request), this.normalizeHeader(cartToken), this.normalizeHeader(tableSessionId), dto);
  }

  @Patch("items/:id")
  updateItem(@Req() request: Request, @Param("id") itemId: string, @Body() dto: UpdateCartItemDto): Promise<CartResponse> {
    return this.cartService.updateItem(this.requireAccess(request), itemId, dto);
  }

  @Delete("items/:id")
  deleteItem(@Req() request: Request, @Param("id") itemId: string): Promise<CartResponse> {
    return this.cartService.deleteItem(this.requireAccess(request), itemId);
  }

  private requireAccess(request: Request): CartAccessContext {
    if (!request.cartAccessContext) {
      throw invalidToken();
    }
    return request.cartAccessContext;
  }

  private normalizeHeader(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
  }
}
