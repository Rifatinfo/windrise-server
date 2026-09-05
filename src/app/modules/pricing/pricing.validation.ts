import { z } from "zod";

const costLine = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  amount: z.number().min(0).max(100_000_000),
});

/** Shared by templates and the compute/report endpoints. */
const inputShape = {
  productName: z.string().trim().max(160).nullable().optional(),
  currency: z.string().trim().max(10).optional(),
  costs: z.array(costLine).max(40),
  platformFee: z.number().min(0).max(100_000_000).optional(),
  platformFeeMode: z.enum(["PERCENT", "FLAT"]).optional(),
  marginMode: z.enum(["MARGIN", "MARKUP"]).optional(),
  targetMargin: z.number().min(0).max(1000).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  roundTo: z.number().min(0).max(10_000).optional(),
  minSellingPrice: z.number().min(0).max(100_000_000).nullable().optional(),
  maxDiscountPercent: z.number().min(0).max(100).optional(),
  pricingStrategy: z.string().trim().max(40).optional(),
  recommendedMargin: z.number().min(0).max(1000).optional(),
};

const templateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(80),
  ...inputShape,
});

const reportSchema = z.object(inputShape);

export const PricingValidation = { templateSchema, reportSchema };
