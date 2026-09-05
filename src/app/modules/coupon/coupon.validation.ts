import { z } from "zod";

const createCouponSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(32)
    .transform((v) => v.trim().toUpperCase()),
  type: z.enum(["PERCENTAGE", "FIXED"]),
  value: z.number().positive(),
  minOrderAmount: z.number().min(0).optional(),
  maxDiscount: z.number().min(0).optional(),
  usageLimit: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const updateCouponSchema = createCouponSchema.partial();

const validateCouponSchema = z.object({
  code: z.string().min(1),
  subtotal: z.number().min(0),
});

export const CouponValidation = {
  createCouponSchema,
  updateCouponSchema,
  validateCouponSchema,
};
