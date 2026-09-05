import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { FinanceService } from "./finance.service";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

const getOverview = catchAsync(async (req: Request, res: Response) => {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  ok(res, "Financial overview fetched", await FinanceService.getOverview(month));
});

const setRevenue = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Revenue updated", await FinanceService.setRevenue(req.body.month, req.body.amount));
});

const listCategories = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Categories fetched", await FinanceService.listCategories());
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Category added",
    data: await FinanceService.createCategory(req.body),
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Category updated", await FinanceService.updateCategory(req.params.id as string, req.body));
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Category deleted", await FinanceService.deleteCategory(req.params.id as string));
});

const listInvestments = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Investment log fetched",
    await FinanceService.listInvestments({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      categoryId: typeof req.query.categoryId === "string" ? req.query.categoryId : undefined,
      searchTerm: typeof req.query.searchTerm === "string" ? req.query.searchTerm : undefined,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    }),
  );
});

const createInvestment = catchAsync(async (req: Request & { user?: any }, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Entry added to the investment log",
    data: await FinanceService.createInvestment(req.body, req.user?.id),
  });
});

const updateInvestment = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Entry updated", await FinanceService.updateInvestment(req.params.id as string, req.body));
});

const deleteInvestment = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Entry deleted", await FinanceService.deleteInvestment(req.params.id as string));
});

const listProductOptions = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Products fetched", await FinanceService.listProductOptions());
});

export const FinanceController = {
  getOverview,
  setRevenue,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listInvestments,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  listProductOptions,
};
