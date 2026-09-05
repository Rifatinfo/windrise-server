import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { SettingsService } from "./settings.service";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

const getSettings = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Settings fetched", await SettingsService.getStoreSettings());
});

const getPublicSettings = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Public settings fetched", await SettingsService.getPublicSettings());
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  // Empty strings from the form mean "clear this optional field".
  const payload = { ...req.body };
  for (const key of ["supportEmail", "supportPhone", "storeAddress"] as const) {
    if (payload[key] === "") payload[key] = null;
  }
  ok(res, "Settings updated", await SettingsService.updateStoreSettings(payload));
});

export const SettingsController = {
  getSettings,
  getPublicSettings,
  updateSettings,
};
