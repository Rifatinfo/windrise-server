import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ModerationService } from "./moderation.service";

const listSchema = z.object({
  source: z.enum(["PRODUCT", "BLOG"]).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const paramsSchema = z.object({
  source: z.enum(["PRODUCT", "BLOG"]),
  id: z.string().min(1),
});

const listComments = catchAsync(async (req: Request, res: Response) => {
  const options = listSchema.parse(req.query);
  const result = await ModerationService.listComments(options);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Comments fetched",
    meta: result.meta,
    data: { comments: result.data, counts: result.counts },
  });
});

const deleteComment = catchAsync(async (req: Request, res: Response) => {
  const { source, id } = paramsSchema.parse(req.params);
  const result = await ModerationService.deleteComment(source, id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message:
      result.deleted > 1
        ? `Comment and ${result.deleted - 1} repl${result.deleted - 1 === 1 ? "y" : "ies"} deleted`
        : "Comment deleted",
    data: result,
  });
});

export const ModerationController = { listComments, deleteComment };
