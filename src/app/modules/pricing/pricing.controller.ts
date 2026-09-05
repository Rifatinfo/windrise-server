import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PricingService } from "./pricing.service";
import { buildPricingReport } from "./pricing.report";
import type { PricingInput } from "./pricing.calc";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

/** Pull the calculator inputs out of a request body. */
const toInput = (body: any): PricingInput => ({
  costs: body.costs ?? [],
  platformFee: body.platformFee ?? 0,
  platformFeeMode: body.platformFeeMode ?? "PERCENT",
  marginMode: body.marginMode ?? "MARGIN",
  targetMargin: body.targetMargin ?? 40,
  taxPercent: body.taxPercent ?? 0,
  roundTo: body.roundTo ?? 0,
  minSellingPrice: body.minSellingPrice ?? null,
});

const listTemplates = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Templates fetched", await PricingService.listTemplates());
});

const getTemplate = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Template fetched", await PricingService.getTemplate(req.params.id as string));
});

const createTemplate = catchAsync(async (req: Request & { user?: any }, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Template saved",
    data: await PricingService.createTemplate(req.body, req.user?.id),
  });
});

const updateTemplate = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Template updated", await PricingService.updateTemplate(req.params.id as string, req.body));
});

const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Template deleted", await PricingService.deleteTemplate(req.params.id as string));
});

/** Server-side recompute — useful for verifying what the browser showed. */
const compute = catchAsync(async (req: Request, res: Response) => {
  const input = toInput(req.body);
  ok(res, "Pricing calculated", PricingService.compute(input, req.body.recommendedMargin ?? 40));
});

const downloadReport = catchAsync(async (req: Request, res: Response) => {
  const input = toInput(req.body);
  const { result, tiers } = PricingService.compute(input, req.body.recommendedMargin ?? 40);

  const pdf = await buildPricingReport({
    productName: req.body.productName ?? "",
    currency: req.body.currency ?? "BDT",
    input,
    result,
    tiers,
  });

  const safeName = String(req.body.productName ?? "pricing")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="pricing-${safeName || "report"}.pdf"`);
  res.send(pdf);
});

export const PricingController = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  compute,
  downloadReport,
};
