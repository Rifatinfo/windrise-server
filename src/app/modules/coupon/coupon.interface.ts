import { CouponType } from "@prisma/client";

export interface CreateCouponDTO {
  code: string;
  type: CouponType;
  value: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  usageLimit?: number;
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
}

export type UpdateCouponDTO = Partial<CreateCouponDTO>;

export interface ValidateCouponDTO {
  code: string;
  subtotal: number;
}
