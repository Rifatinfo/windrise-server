import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { CouponService } from "./coupon.service";

const createCoupon = catchAsync(async (req: Request, res: Response) => {
  const result = await CouponService.createCouponService(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Coupon created successfully",
    data: result,
  });
});

const getAllCoupons = catchAsync(async (req: Request, res: Response) => {
  const result = await CouponService.getAllCouponsService();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Coupons fetched successfully",
    data: result,
  });
});

const updateCoupon = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CouponService.updateCouponService(id as string, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Coupon updated successfully",
    data: result,
  });
});

const deactivateCoupon = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CouponService.deactivateCouponService(id as string);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Coupon deactivated successfully",
    data: result,
  });
});

const validateCoupon = catchAsync(async (req: Request, res: Response) => {
  const result = await CouponService.validateCouponService(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Coupon is valid",
    data: result,
  });
});

export const CouponController = {
  createCoupon,
  getAllCoupons,
  updateCoupon,
  deactivateCoupon,
  validateCoupon,
};
