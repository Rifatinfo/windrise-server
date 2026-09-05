import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../errors/ApiError";
import { ReviewService } from "./review.service";
import { ReviewValidation } from "./review.validation";

const checkEligibility = catchAsync(async (req: Request, res: Response) => {
  const { productId, phone } = ReviewValidation.eligibilitySchema.parse(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Eligibility checked",
    data: await ReviewService.checkEligibility(productId, phone),
  });
});

const submitReview = catchAsync(async (req: Request, res: Response) => {
  const payload = ReviewValidation.submitSchema.parse(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Thanks! Your review has been posted.",
    data: await ReviewService.submitReview(payload),
  });
});

const listReviews = catchAsync(async (req: Request, res: Response) => {
  const { page, limit } = ReviewValidation.listQuerySchema.parse(req.query);
  const result = await ReviewService.listReviews(req.params.productId as string, {
    page,
    limit,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Reviews fetched",
    meta: result.meta,
    // The summary rides along with the page so the score, the star bars and
    // the list all arrive in one request instead of three.
    data: { summary: result.summary, reviews: result.data },
  });
});

const uploadImage = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, "No image uploaded");

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Image uploaded",
    data: await ReviewService.uploadReviewImage(req.file),
  });
});

export const ReviewController = {
  checkEligibility,
  submitReview,
  listReviews,
  uploadImage,
};
