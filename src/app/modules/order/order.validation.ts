import { z } from "zod";

/**
 * Public order lookup. The order number alone is only six digits, so the phone
 * number on the order acts as the second factor — both are required and both
 * must match before anything is returned.
 */
const trackOrderSchema = z.object({
  body: z.object({
    orderNo: z
      .string({ required_error: "Order ID is required" })
      .trim()
      .min(1, "Order ID is required")
      .max(64, "Order ID is too long"),
    phone: z
      .string({ required_error: "Phone number is required" })
      .trim()
      .min(1, "Phone number is required")
      .max(32, "Phone number is too long")
      .refine((value) => value.replace(/\D/g, "").length >= 6, {
        message: "Enter a valid phone number",
      }),
  }),
});

export const OrderValidation = {
  trackOrderSchema,
};
