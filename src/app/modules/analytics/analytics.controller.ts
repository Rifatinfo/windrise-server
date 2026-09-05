import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AnalyticsService } from "./analytics.service";

// Storefront event ingestion is fire-and-forget from the client — never let it fail loudly.
const trackEvent = catchAsync(async (req: Request, res: Response) => {
  await AnalyticsService.trackEventService(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Event recorded",
    data: null,
  });
});

export const AnalyticsController = { trackEvent };
