import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../errors/ApiError";
import { AdsService } from "./ads.service";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

const created = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.CREATED, success: true, message, data });

const listAds = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Ads fetched", await AdsService.listAds(req.query as any));
});

const getAdStats = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Ad stats fetched", await AdsService.getAdStats());
});

const getAdById = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Ad fetched", await AdsService.getAdById(req.params.id as string));
});

const createAd = catchAsync(async (req: Request, res: Response) => {
  created(res, "Ad created", await AdsService.createAd(req.body));
});

const updateAd = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Ad updated", await AdsService.updateAd(req.params.id as string, req.body));
});

const deleteAd = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Ad deleted", await AdsService.deleteAd(req.params.id as string));
});

const bulkDelete = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Ads deleted", await AdsService.bulkDelete(req.body.ids));
});

const bulkUpdateStatus = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Ads updated", await AdsService.bulkUpdateStatus(req.body.ids, req.body.status));
});

const uploadCreative = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, "No creative uploaded");
  ok(res, "Creative uploaded", await AdsService.uploadCreative(req.file));
});

const listPlacements = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Placements fetched", await AdsService.listPlacements());
});

const createPlacement = catchAsync(async (req: Request, res: Response) => {
  created(res, "Placement created", await AdsService.createPlacement(req.body));
});

const updatePlacement = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Placement updated", await AdsService.updatePlacement(req.params.id as string, req.body));
});

const deletePlacement = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Placement deleted", await AdsService.deletePlacement(req.params.id as string));
});

const listActiveAds = catchAsync(async (req: Request, res: Response) => {
  ok(
    res,
    "Active ads fetched",
    await AdsService.listActiveAds({
      placementKey: req.query.placement as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
    }),
  );
});

const recordImpression = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Impression recorded", await AdsService.recordImpression(req.params.id as string));
});

const recordClick = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Click recorded", await AdsService.recordClick(req.params.id as string));
});

export const AdsController = {
  listAds,
  getAdStats,
  getAdById,
  createAd,
  updateAd,
  deleteAd,
  bulkDelete,
  bulkUpdateStatus,
  uploadCreative,
  listPlacements,
  createPlacement,
  updatePlacement,
  deletePlacement,
  listActiveAds,
  recordImpression,
  recordClick,
};
