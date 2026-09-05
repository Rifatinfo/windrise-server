import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { InventoryService } from "./inventory.service";
import type { InventoryDateRange } from "./inventory.service";

// Expects yyyy-mm-dd query params; anything invalid falls back to the default window
const parseDateRange = (query: Request["query"]): InventoryDateRange | undefined => {
  const { start, end } = query;
  if (typeof start !== "string" || typeof end !== "string") return undefined;

  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T23:59:59.999`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return undefined;
  }
  if (startDate > endDate) return undefined;

  return { start: startDate, end: endDate };
};

const getInventoryOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await InventoryService.getInventoryOverview(
    parseDateRange(req.query),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Inventory overview retrieved successfully",
    data: result,
  });
});

const adjustProductStock = catchAsync(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { deltas } = req.body as { deltas: Record<string, number> };

  // Returns the full fresh overview so the dashboard stays in sync
  const result = await InventoryService.adjustProductStock(
    productId as string,
    deltas,
    parseDateRange(req.query),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Stock updated successfully",
    data: result,
  });
});

export const InventoryController = {
  getInventoryOverview,
  adjustProductStock,
};
