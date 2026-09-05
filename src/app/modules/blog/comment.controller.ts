import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { CommentService } from "./comment.service";

/** Populated by optionalAuth when a valid token is present. */
type MaybeAuthed = Request & { user?: { id?: string; email?: string } };

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const createSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(2000),
  parentId: z.string().min(1).nullable().optional(),
});

const listComments = catchAsync(async (req: Request, res: Response) => {
  const { page, limit } = listQuerySchema.parse(req.query);
  const result = await CommentService.listComments(req.params.slug as string, {
    page,
    limit,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Comments fetched",
    meta: result.meta,
    data: { comments: result.data, totalComments: result.totalComments },
  });
});

const createComment = catchAsync(async (req: MaybeAuthed, res: Response) => {
  const payload = createSchema.parse(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Comment posted",
    data: await CommentService.createComment(
      { ...payload, slug: req.params.slug as string },
      req.user?.id ? { id: req.user.id, email: req.user.email } : undefined,
    ),
  });
});

export const CommentController = {
  listComments,
  createComment,
};
