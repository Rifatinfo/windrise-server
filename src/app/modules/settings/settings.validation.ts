import { z } from "zod";

const optionalTrimmed = (max: number) =>
  z.string().trim().max(max).optional().nullable();

const money = z.number().min(0, "Must be zero or more").max(1_000_000);

/**
 * Every field is optional so the Settings page can save one section at a
 * time without having to resend the whole record.
 */
export const updateStoreSettingsSchema = z
  .object({
    storeName: z.string().trim().min(1, "Store name is required").max(80).optional(),
    supportEmail: z
      .union([z.string().trim().email("Enter a valid email address"), z.literal("")])
      .optional()
      .nullable(),
    supportPhone: optionalTrimmed(30),
    storeAddress: optionalTrimmed(200),

    shippingDhakaCity: money.optional(),
    shippingDhakaSuburb: money.optional(),
    shippingOutsideDhaka: money.optional(),
    freeShippingThreshold: money.nullable().optional(),

    lowStockThreshold: z
      .number()
      .int("Must be a whole number")
      .min(1, "Must be at least 1")
      .max(10_000)
      .optional(),

    orderNumberPrefix: z.string().trim().max(8).optional(),

    notifyOrderPlaced: z.boolean().optional(),
    notifyOrderStatus: z.boolean().optional(),
    notifyLowStock: z.boolean().optional(),
  })
  .strict();

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;
