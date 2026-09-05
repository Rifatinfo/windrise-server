import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .url("Enter a full URL, including https://")
  .nullable()
  .optional()
  .or(z.literal(""));

const base = {
  name: z.string().trim().min(1, "Ad name is required").max(120),
  type: z.enum(["INTERNAL", "SPONSORED"]).optional(),
  sponsorName: z.string().trim().max(120).nullable().optional(),
  sponsorEmail: z.string().trim().email("Enter a valid email").nullable().optional().or(z.literal("")),
  placementId: z.string().trim().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "SCHEDULED", "EXPIRED"]).optional(),
  imageUrl: z.string().trim().nullable().optional(),
  htmlSnippet: z.string().nullable().optional(),
  targetUrl: optionalUrl,
  openInNewTab: z.boolean().optional(),
  /** 0-100, drives which ad wins a contested slot. */
  priority: z.number().int().min(0).max(100).optional(),
  frequencyCap: z.number().int().min(0).max(100).nullable().optional(),
  utmSource: z.string().trim().max(120).nullable().optional(),
  utmMedium: z.string().trim().max(120).nullable().optional(),
  utmCampaign: z.string().trim().max(120).nullable().optional(),
  /** Empty array means all categories. */
  categoryIds: z.array(z.string().min(1)).max(50).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
};

const createAdSchema = z.object(base);
const updateAdSchema = z.object({ ...base, name: base.name.optional() });

const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one ad"),
});

const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one ad"),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "SCHEDULED", "EXPIRED"]),
});

const createPlacementSchema = z.object({
  name: z.string().trim().min(1, "Placement name is required").max(80),
  description: z.string().trim().max(200).nullable().optional(),
  width: z.number().int().min(1).max(4000).nullable().optional(),
  height: z.number().int().min(1).max(4000).nullable().optional(),
  isNative: z.boolean().optional(),
});

const updatePlacementSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  width: z.number().int().min(1).max(4000).nullable().optional(),
  height: z.number().int().min(1).max(4000).nullable().optional(),
});

export const AdsValidation = {
  createAdSchema,
  updateAdSchema,
  bulkIdsSchema,
  bulkStatusSchema,
  createPlacementSchema,
  updatePlacementSchema,
};
