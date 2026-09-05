import { z } from "zod";

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1");

const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(60),
  color: hexColor.optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: hexColor.optional(),
});

const investmentSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero").max(1_000_000_000),
  description: z.string().trim().min(1, "Description is required").max(200),
  spentAt: z.string().trim().min(1, "Pick a date"),
  vendor: z.string().trim().max(120).nullable().optional(),
  categoryId: z.string().trim().min(1, "Pick a category"),
  productId: z.string().trim().nullable().optional(),
});

const updateInvestmentSchema = investmentSchema.partial();

const revenueSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must look like 2026-08"),
  amount: z.number().min(0).max(1_000_000_000),
});

export const FinanceValidation = {
  createCategorySchema,
  updateCategorySchema,
  investmentSchema,
  updateInvestmentSchema,
  revenueSchema,
};
