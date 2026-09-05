import { z } from "zod";

const trackEventSchema = z.object({
  type: z.enum(["PAGE_VIEW", "PRODUCT_VIEW", "ADD_TO_CART", "CHECKOUT_START"]),
  sessionId: z.string().min(1).max(64),
  productId: z.string().max(64).optional(),
  path: z.string().max(256).optional(),
});

export const AnalyticsValidation = { trackEventSchema };
