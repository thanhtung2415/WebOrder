import { CartStatus, ReservationStatus } from "@prisma/client";
import { BranchContext } from "../auth/branch-context";
import { QrSessionContext } from "../tables/table.types";

export type CartAccessContext = { kind: "qr"; qr: QrSessionContext } | { kind: "staff"; branch: BranchContext };

export interface CartReservationResponse {
  id: string;
  inventoryId: string;
  ingredientId: string;
  status: ReservationStatus | "EXPIRED_PENDING";
  quantity: string;
  expiresAt: string;
  terminalAt: string | null;
}

export interface CartItemOptionResponse {
  id: string;
  productOptionValueId: string;
  optionGroupId: string;
  optionGroupCode: string;
  optionGroupName: string;
  optionValueId: string;
  optionValueCode: string;
  optionValueName: string;
  priceDelta: string;
}

export interface CartItemResponse {
  id: string;
  product: {
    id: string;
    code: string;
    name: string;
    imagePath: string | null;
  };
  quantity: number;
  note: string | null;
  isTakeaway: boolean;
  unitPrice: string;
  lineSubtotal: string;
  reservationStatus: "ACTIVE" | "EXPIRED" | "RELEASED" | "UNAVAILABLE";
  reservationExpiresAt: string | null;
  options: CartItemOptionResponse[];
  reservations: CartReservationResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface CartResponse {
  id: string;
  token: string;
  branchId: string;
  tableSessionId: string;
  status: CartStatus;
  items: CartItemResponse[];
  subtotal: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}
