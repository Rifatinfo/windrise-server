
import { DeliveryType } from "@prisma/client";

export interface CartItemDTO {
  productId: string;
  quantity: number;
  color?: string;
  size?: string;
  sku? : string;
}

export interface DeliveryInfoDTO {
  name: string;
  phone: string;
  state: string;
  address: string;
}

export interface BillingInfoDTO {
  name: string;
  phone: string;
  email?: string | null;
  state: string;
  address: string;
}

export interface CreateOrderDTO {
  deliveryInfo: DeliveryInfoDTO;
  billingInfo?: BillingInfoDTO;
  deliveryType: DeliveryType;
  cartItems: CartItemDTO[];
  paymentMethod: "ONLINE" | "COD";
  checkoutEmail?: string;
  couponCode?: string;
}

export interface UpdateOrderInfoDTO {
  name?: string;
  phone?: string;
  state?: string;
  address?: string;
  orderNote?: string | null;
  billingName?: string | null;
  billingPhone?: string | null;
  billingEmail?: string | null;
  billingState?: string | null;
  billingAddress?: string | null;
}