import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../errors/ApiError";
import prisma from "../../../shared/prisma";
import { openStream } from "../support/support.realtime";
import { ChatbotService } from "./chatbot.service";

const ok = (res: Response, message: string, data: unknown) =>
  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message, data });

/**
 * The widget is used by signed-out visitors, so these routes are public. Where
 * a session belongs to a signed-in user, `req.user` is populated by the
 * optional auth middleware and passed through for order attribution.
 */
type MaybeAuthed = Request & { user?: { id?: string; email?: string } };

const start = catchAsync(async (req: MaybeAuthed, res: Response) => {
  const { visitorId, ...payload } = req.body;
  ok(
    res,
    "Chat ready",
    await ChatbotService.startSession(payload, {
      visitorId,
      userId: req.user?.id,
      userEmail: req.user?.email,
    }),
  );
});

const getSession = catchAsync(async (req: Request, res: Response) => {
  const visitorId = String(req.query.visitorId ?? "");
  if (!visitorId) throw new ApiError(StatusCodes.BAD_REQUEST, "Missing visitor id");

  ok(
    res,
    "Chat fetched",
    await ChatbotService.getSession(req.params.sessionId as string, visitorId),
  );
});

const sendMessage = catchAsync(async (req: MaybeAuthed, res: Response) => {
  const { visitorId, sessionId, text, imageUrl } = req.body;

  if (!text && !imageUrl) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Send a message or an image");
  }

  ok(
    res,
    "Reply ready",
    await ChatbotService.sendMessage(
      { sessionId, text, imageUrl },
      { visitorId, userId: req.user?.id, userEmail: req.user?.email },
    ),
  );
});

const confirmPending = catchAsync(async (req: MaybeAuthed, res: Response) => {
  const { visitorId, sessionId } = req.body;
  ok(
    res,
    'Confirmed',
    await ChatbotService.confirmPending(sessionId, {
      visitorId,
      userId: req.user?.id,
      userEmail: req.user?.email,
    }),
  );
});

const declinePending = catchAsync(async (req: Request, res: Response) => {
  const { visitorId, sessionId } = req.body;
  ok(res, 'Declined', await ChatbotService.declinePending(sessionId, visitorId));
});

const requestHuman = catchAsync(async (req: Request, res: Response) => {
  const { visitorId, sessionId } = req.body;
  ok(res, "Support requested", await ChatbotService.requestHuman(sessionId, visitorId));
});

const resumeAi = catchAsync(async (req: Request, res: Response) => {
  const { visitorId, sessionId } = req.body;
  ok(res, "Back with Windee", await ChatbotService.resumeAi(sessionId, visitorId));
});

const closeSession = catchAsync(async (req: Request, res: Response) => {
  const { visitorId, sessionId } = req.body;
  ok(res, "Chat closed", await ChatbotService.closeSession(sessionId, visitorId));
});

/**
 * The widget's live feed.
 *
 * Only fires for one chat session, and the visitor id has to match it — the
 * same pair that guards every other endpoint here. Not wrapped in `catchAsync`
 * or `sendResponse`: the response is hijacked and stays open.
 */
const stream = async (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId ?? "");
  const visitorId = String(req.query.visitorId ?? "");

  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });

  if (!session || session.visitorId !== visitorId) {
    res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Chat session not found" });
    return;
  }

  openStream(res, { accept: (event) => event.chatSessionId === sessionId });
};

const uploadImage = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, "No image uploaded");
  ok(res, "Image uploaded", await ChatbotService.uploadImage(req.file));
});

export const ChatbotController = {
  start,
  confirmPending,
  declinePending,
  getSession,
  sendMessage,
  requestHuman,
  resumeAi,
  closeSession,
  stream,
  uploadImage,
};
