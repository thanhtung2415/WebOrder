import { Body, Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { invalidToken } from "../../common/errors/api-exception";
import { CancelOrderItemDto, ConfirmOrderDto, UpdateOrderItemStatusDto } from "./dto/order.dto";
import { OrderAccessGuard } from "./guards/order-access.guard";
import { OrderAccessContext, OrderListResponse, OrderResponse, QueueResponse } from "./order.types";
import { OrdersService } from "./orders.service";

@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(OrderAccessGuard)
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post("orders")
  confirmOrder(
    @Req() request: Request,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-cart-token") cartToken: string | undefined,
    @Headers("x-table-session-id") tableSessionId: string | undefined,
    @Body() dto: ConfirmOrderDto
  ): Promise<OrderResponse> {
    return this.ordersService.confirmOrder(this.requireAccess(request), idempotencyKey, this.normalizeHeader(cartToken), this.normalizeHeader(tableSessionId), dto);
  }

  @Get("orders/:id")
  getOrder(@Req() request: Request, @Param("id") orderId: string): Promise<OrderResponse> {
    return this.ordersService.getOrder(this.requireAccess(request), orderId);
  }

  @Get("table-sessions/:id/orders")
  getSessionOrders(@Req() request: Request, @Param("id") tableSessionId: string): Promise<OrderListResponse> {
    return this.ordersService.getSessionOrders(this.requireAccess(request), tableSessionId);
  }

  @Patch("order-items/:id/status")
  updateItemStatus(@Req() request: Request, @Param("id") itemId: string, @Body() dto: UpdateOrderItemStatusDto): Promise<OrderResponse> {
    return this.ordersService.updateItemStatus(this.requireAccess(request), itemId, dto);
  }

  @Post("order-items/:id/cancellation")
  cancelItem(@Req() request: Request, @Param("id") itemId: string, @Body() dto: CancelOrderItemDto): Promise<OrderResponse> {
    return this.ordersService.cancelItem(this.requireAccess(request), itemId, dto);
  }

  @Get("bar/queue")
  getBarQueue(@Req() request: Request): Promise<QueueResponse> {
    return this.ordersService.getQueue(this.requireAccess(request), "BAR");
  }

  @Get("kitchen/queue")
  getKitchenQueue(@Req() request: Request): Promise<QueueResponse> {
    return this.ordersService.getQueue(this.requireAccess(request), "KITCHEN");
  }

  private requireAccess(request: Request): OrderAccessContext {
    if (!request.orderAccessContext) {
      throw invalidToken();
    }
    return request.orderAccessContext;
  }

  private normalizeHeader(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
  }
}
