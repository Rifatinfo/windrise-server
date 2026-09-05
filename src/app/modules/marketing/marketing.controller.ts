import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { MarketingService } from "./marketing.service";

const toGa4Date = (value: unknown, fallbackDaysAgo: number) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date();
  date.setDate(date.getDate() - fallbackDaysAgo);
  return date.toISOString().slice(0, 10);
};

const getRange = (query: Request["query"]) => ({
  startDate: toGa4Date(query.startDate, 30),
  endDate: toGa4Date(query.endDate, 0),
});

const getTrafficOverview = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = getRange(req.query);
  const result = await MarketingService.getTrafficOverview(startDate, endDate);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Website traffic overview fetched",
    data: result,
  });
});

const getTrafficSources = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = getRange(req.query);
  const result = await MarketingService.getTrafficSources(startDate, endDate);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Traffic sources fetched",
    data: result,
  });
});

const getMetaAds = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = getRange(req.query);
  const result = await MarketingService.getMetaAdsPerformance(startDate, endDate);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Meta Ads performance fetched",
    data: result,
  });
});

const getGoogleAds = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = getRange(req.query);
  const result = await MarketingService.getGoogleAdsPerformance(startDate, endDate);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Google Ads performance fetched",
    data: result,
  });
});

const getPerformance = catchAsync(async (req: Request, res: Response) => {
  const { startDate, endDate } = getRange(req.query);
  const result = await MarketingService.getMarketingPerformance(startDate, endDate);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Marketing performance fetched",
    data: result,
  });
});

export const MarketingController = {
  getTrafficOverview,
  getTrafficSources,
  getMetaAds,
  getGoogleAds,
  getPerformance,
};
