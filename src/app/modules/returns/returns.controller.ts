import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ReturnService } from "./returns.service";

const createReturn = catchAsync(async (req: Request, res: Response) => {
  const result = await ReturnService.createReturnService(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Return recorded successfully",
    data: result,
  });
});

const getAllReturns = catchAsync(async (req: Request, res: Response) => {
  const { status } = req.query;
  const result = await ReturnService.getAllReturnsService(status as string | undefined);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Returns fetched successfully",
    data: result,
  });
});

const updateReturn = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await ReturnService.updateReturnService(id as string, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Return updated successfully",
    data: result,
  });
});

export const ReturnController = { createReturn, getAllReturns, updateReturn };
