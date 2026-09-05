import { z } from "zod";

const reasonEnum = z.enum([
  "WRONG_SIZE",
  "DAMAGED_PRODUCT",
  "WRONG_PRODUCT",
  "CHANGED_MIND",
  "NOT_AS_EXPECTED",
  "OTHER",
]);

const createReturnSchema = z.object({
  orderId: z.string().min(1),
  reason: reasonEnum,
  note: z.string().optional(),
});

const updateReturnSchema = z.object({
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "COMPLETED"]).optional(),
  refundStatus: z.enum(["PENDING", "COMPLETED"]).optional(),
  refundAmount: z.number().min(0).optional(),
});

export const ReturnValidation = { createReturnSchema, updateReturnSchema };
