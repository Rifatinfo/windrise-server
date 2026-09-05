import { StatusCodes } from "http-status-codes";
import { Prisma } from "@prisma/client";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { buildTiers, calculatePricing, type CostLine, type PricingInput } from "./pricing.calc";

export type TemplatePayload = {
  name: string;
  productName?: string | null;
  currency?: string;
  costs: CostLine[];
  platformFee?: number;
  platformFeeMode?: "PERCENT" | "FLAT";
  marginMode?: "MARGIN" | "MARKUP";
  targetMargin?: number;
  taxPercent?: number;
  roundTo?: number;
  minSellingPrice?: number | null;
  maxDiscountPercent?: number;
  pricingStrategy?: string;
  recommendedMargin?: number;
};

const shape = (row: Prisma.PricingTemplateGetPayload<object>) => ({
  id: row.id,
  name: row.name,
  productName: row.productName,
  currency: row.currency,
  costs: (row.costs as unknown as CostLine[]) ?? [],
  platformFee: row.platformFee,
  platformFeeMode: row.platformFeeMode as "PERCENT" | "FLAT",
  marginMode: row.marginMode as "MARGIN" | "MARKUP",
  targetMargin: row.targetMargin,
  taxPercent: row.taxPercent,
  roundTo: row.roundTo,
  minSellingPrice: row.minSellingPrice,
  maxDiscountPercent: row.maxDiscountPercent,
  pricingStrategy: row.pricingStrategy,
  recommendedMargin: row.recommendedMargin,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toData = (payload: TemplatePayload) => ({
  name: payload.name.trim(),
  productName: payload.productName ?? null,
  currency: payload.currency ?? "BDT",
  costs: payload.costs as unknown as Prisma.InputJsonValue,
  platformFee: payload.platformFee ?? 0,
  platformFeeMode: payload.platformFeeMode ?? "PERCENT",
  marginMode: payload.marginMode ?? "MARGIN",
  targetMargin: payload.targetMargin ?? 40,
  taxPercent: payload.taxPercent ?? 0,
  roundTo: payload.roundTo ?? 0,
  minSellingPrice: payload.minSellingPrice ?? null,
  maxDiscountPercent: payload.maxDiscountPercent ?? 0,
  pricingStrategy: payload.pricingStrategy ?? "VALUE_BASED",
  recommendedMargin: payload.recommendedMargin ?? 40,
});

const listTemplates = async () => {
  const rows = await prisma.pricingTemplate.findMany({ orderBy: { updatedAt: "desc" } });
  return rows.map(shape);
};

const getTemplate = async (id: string) => {
  const row = await prisma.pricingTemplate.findUnique({ where: { id } });
  if (!row) throw new ApiError(StatusCodes.NOT_FOUND, "Template not found");
  return shape(row);
};

const createTemplate = async (payload: TemplatePayload, userId?: string) => {
  const clash = await prisma.pricingTemplate.findFirst({ where: { name: payload.name.trim() } });
  if (clash) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "A saved pricing with that name already exists. Pick another name, or edit the existing one.",
    );
  }
  const row = await prisma.pricingTemplate.create({
    data: { ...toData(payload), createdById: userId ?? null },
  });
  return shape(row);
};

const updateTemplate = async (id: string, payload: TemplatePayload) => {
  const existing = await prisma.pricingTemplate.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Template not found");

  const row = await prisma.pricingTemplate.update({ where: { id }, data: toData(payload) });
  return shape(row);
};

const deleteTemplate = async (id: string) => {
  await prisma.pricingTemplate.delete({ where: { id } }).catch(() => {
    throw new ApiError(StatusCodes.NOT_FOUND, "Template not found");
  });
  return { id };
};

/**
 * Recomputes the figures server-side rather than trusting numbers posted from
 * the browser, so an exported report can always be relied on.
 */
const compute = (input: PricingInput, recommendedMargin: number) => ({
  result: calculatePricing(input),
  tiers: buildTiers(input, recommendedMargin),
});

export const PricingService = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  compute,
};
