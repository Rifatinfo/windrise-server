import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../errors/ApiError";
import { StatsService } from "./stats.service";
import { exportReport, ExportFormat, ExportType } from "./stats.export.service";
import { parseDateRange, parseGranularity, parseLimit } from "./stats.utils";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Sales summary fetched", await StatsService.getSummary(start, end));
});

const getRevenueChart = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  const granularity = parseGranularity(req.query);
  ok(res, "Revenue chart fetched", await StatsService.getRevenueChart(start, end, granularity));
});

const getCategoryRevenueSeries = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  const granularity = parseGranularity(req.query);
  ok(
    res,
    "Category revenue series fetched",
    await StatsService.getCategoryRevenueSeries(start, end, granularity),
  );
});

const getOrderStatusOverview = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Order status overview fetched", await StatsService.getOrderStatusOverview(start, end));
});

const getRecentOrders = catchAsync(async (req: Request, res: Response) => {
  const limit = parseLimit(req.query, 10, 50);
  ok(res, "Recent orders fetched", await StatsService.getRecentOrders(limit));
});

const getTopProducts = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  const limit = parseLimit(req.query, 10, 50);
  ok(res, "Top products fetched", await StatsService.getTopProducts(start, end, limit));
});

const getSalesByCategory = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Sales by category fetched", await StatsService.getSalesByCategory(start, end));
});

const getSalesBySubcategory = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Sales by subcategory fetched", await StatsService.getSalesBySubcategory(start, end));
});

const getSalesByPaymentMethod = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Sales by payment method fetched", await StatsService.getSalesByPaymentMethod(start, end));
});

const getSalesByLocation = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Sales by location fetched", await StatsService.getSalesByLocation(start, end));
});

const getCustomersOverview = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Customers overview fetched", await StatsService.getCustomersOverview(start, end));
});

const getNewVsReturning = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "New vs returning customers fetched", await StatsService.getNewVsReturning(start, end));
});

const getReturnsOverview = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Returns overview fetched", await StatsService.getReturnsOverview(start, end));
});

const getReturnReasons = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Return reasons fetched", await StatsService.getReturnReasons(start, end));
});

const getInventorySummary = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Inventory summary fetched", await StatsService.getInventorySummary());
});

const getCouponsPerformance = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Coupon performance fetched", await StatsService.getCouponsPerformance(start, end));
});

const getDiscountsPerformance = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Discount performance fetched", await StatsService.getDiscountsPerformance(start, end));
});

const getSalesFunnel = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Sales funnel fetched", await StatsService.getSalesFunnel(start, end));
});

const getProductPerformance = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  const limit = parseLimit(req.query, 20, 100);
  ok(res, "Product performance fetched", await StatsService.getProductPerformance(start, end, limit));
});

const getSalesTarget = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Sales target fetched", await StatsService.getSalesTarget());
});

const updateSalesTarget = catchAsync(async (req: Request, res: Response) => {
  const targetAmount = Number(req.body?.targetAmount);
  if (!Number.isFinite(targetAmount) || targetAmount < 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "targetAmount must be a non-negative number");
  }
  ok(res, "Sales target updated", await StatsService.updateSalesTarget(targetAmount));
});

const getDailySnapshot = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Daily snapshot fetched", await StatsService.getDailySnapshot());
});

const getBestCustomers = catchAsync(async (req: Request, res: Response) => {
  const limit = parseLimit(req.query, 10, 50);
  ok(res, "Best customers fetched", await StatsService.getBestCustomers(limit));
});

const getCustomerLifetimeValue = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Customer lifetime value fetched", await StatsService.getCustomerLifetimeValue());
});

const getAlerts = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Alerts fetched", await StatsService.getAlerts());
});

const getBusinessPerformance = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query);
  ok(res, "Business performance fetched", await StatsService.getBusinessPerformance(start, end));
});

const VALID_EXPORT_TYPES: ExportType[] = ["sales", "orders", "customers", "products", "payments", "refunds"];
const VALID_EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx", "pdf"];

const exportStatsReport = catchAsync(async (req: Request, res: Response) => {
  const { start, end } = parseDateRange(req.query, 30);
  const type = req.query.type as ExportType;
  const format = req.query.format as ExportFormat;

  if (!VALID_EXPORT_TYPES.includes(type)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `type must be one of ${VALID_EXPORT_TYPES.join(", ")}`);
  }
  if (!VALID_EXPORT_FORMATS.includes(format)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `format must be one of ${VALID_EXPORT_FORMATS.join(", ")}`);
  }

  const { buffer, contentType, filename } = await exportReport(type, format, start, end);

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const StatsController = {
  getSummary,
  getRevenueChart,
  getCategoryRevenueSeries,
  getOrderStatusOverview,
  getRecentOrders,
  getTopProducts,
  getSalesByCategory,
  getSalesBySubcategory,
  getSalesByPaymentMethod,
  getSalesByLocation,
  getCustomersOverview,
  getNewVsReturning,
  getReturnsOverview,
  getReturnReasons,
  getInventorySummary,
  getCouponsPerformance,
  getDiscountsPerformance,
  getSalesFunnel,
  getProductPerformance,
  getSalesTarget,
  updateSalesTarget,
  getDailySnapshot,
  getBestCustomers,
  getCustomerLifetimeValue,
  getAlerts,
  getBusinessPerformance,
  exportStatsReport,
};
