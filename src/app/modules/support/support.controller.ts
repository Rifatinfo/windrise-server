import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import ApiError from "../../errors/ApiError";
import sendResponse from "../../../shared/sendResponse";
import { SupportService } from "./support.service";
import { SupportValidation } from "./support.validation";
import { openStream, streamCount } from "./support.realtime";
import { ingestMessengerMessage } from "./support.ingest";
import { parseInbound, verifyChallenge, verifySignature } from "./support.messenger";

/** Every inbox route runs behind `auth`, so the claims are always present. */
type Authed = Request & { user?: { id: string; role?: string } };

const actor = (req: Authed) => req.user!.id;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const me = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Agent profile fetched",
    data: await SupportService.getMe(actor(req)),
  });
});

const agents = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Agents fetched",
    data: await SupportService.listAgents(),
  });
});

const setPresence = catchAsync(async (req: Authed, res: Response) => {
  const { presence } = SupportValidation.presenceSchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Presence updated",
    data: await SupportService.setPresence(actor(req), presence),
  });
});

const heartbeat = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Heartbeat recorded",
    data: await SupportService.heartbeat(actor(req)),
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const stats = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Support stats fetched",
    data: await SupportService.getStats(actor(req)),
  });
});

const channels = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Channels fetched",
    data: await SupportService.getChannels(),
  });
});

const queues = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Queues fetched",
    data: await SupportService.getQueues(),
  });
});

const createQueue = catchAsync(async (req: Request, res: Response) => {
  const body = SupportValidation.queueSchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Queue created",
    data: await SupportService.createQueue(body.name, body.description),
  });
});

const deleteQueue = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Queue deleted",
    data: await SupportService.deleteQueue(req.params.id),
  });
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const listConversations = catchAsync(async (req: Authed, res: Response) => {
  const filters = SupportValidation.listQuerySchema.parse(req.query);
  const { data, meta } = await SupportService.listConversations(actor(req), filters);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Conversations fetched",
    meta,
    data,
  });
});

const getConversation = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Conversation fetched",
    data: await SupportService.getConversation(actor(req), req.params.id),
  });
});

const markRead = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Marked as read",
    data: await SupportService.markRead(actor(req), req.params.id),
  });
});

const claim = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Conversation assigned to you",
    data: await SupportService.claimConversation(actor(req), req.params.id),
  });
});

const transfer = catchAsync(async (req: Authed, res: Response) => {
  const body = SupportValidation.transferSchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Conversation transferred",
    data: await SupportService.transferConversation(actor(req), req.params.id, body),
  });
});

const setPriority = catchAsync(async (req: Authed, res: Response) => {
  const { priority } = SupportValidation.prioritySchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Priority updated",
    data: await SupportService.setPriority(actor(req), req.params.id, priority),
  });
});

const close = catchAsync(async (req: Authed, res: Response) => {
  const { reason } = SupportValidation.closeSchema.parse(req.body ?? {});
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Conversation closed",
    data: await SupportService.closeConversation(actor(req), req.params.id, reason),
  });
});

const reopen = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Conversation reopened",
    data: await SupportService.reopenConversation(actor(req), req.params.id),
  });
});

const reply = catchAsync(async (req: Authed, res: Response) => {
  const body = SupportValidation.replySchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: body.isInternalNote ? "Note saved" : "Reply sent",
    data: await SupportService.sendReply(actor(req), req.params.id, body),
  });
});

const typing = catchAsync(async (req: Authed, res: Response) => {
  const { on } = SupportValidation.typingSchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Typing state sent",
    data: await SupportService.setTyping(actor(req), req.params.id, on),
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const listTags = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Tags fetched",
    data: await SupportService.listTags(),
  });
});

const addTag = catchAsync(async (req: Authed, res: Response) => {
  const { name } = SupportValidation.tagSchema.parse(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Tag added",
    data: await SupportService.addTag(actor(req), req.params.id, name),
  });
});

const removeTag = catchAsync(async (req: Authed, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Tag removed",
    data: await SupportService.removeTag(actor(req), req.params.id, req.params.tagId),
  });
});

const upload = catchAsync(async (req: Authed, res: Response) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, "No file uploaded");
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Attachment uploaded",
    data: await SupportService.uploadAttachment(actor(req), req.file),
  });
});

// ---------------------------------------------------------------------------
// Live stream
// ---------------------------------------------------------------------------

/**
 * The dashboard's event stream. Not wrapped in `catchAsync` or `sendResponse`:
 * the response is hijacked and stays open, so it must never be handed to code
 * that will try to end it.
 */
const stream = async (req: Authed, res: Response) => {
  try {
    // Proves the caller is really an agent before attaching them to the bus.
    await SupportService.ensureAgent(actor(req));
  } catch {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      message: "You do not have access to the support inbox.",
    });
    return;
  }

  openStream(res, { accept: () => true });
};

const health = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Support realtime healthy",
    data: { subscribers: streamCount() },
  });
});

// ---------------------------------------------------------------------------
// Meta webhook
// ---------------------------------------------------------------------------

/** The one-time subscription handshake. Meta expects the challenge, as text. */
const verifyWebhook = (req: Request, res: Response) => {
  const challenge = verifyChallenge(req.query as Record<string, unknown>);

  if (challenge === null) {
    res.status(StatusCodes.FORBIDDEN).send("Verification failed");
    return;
  }

  res.status(StatusCodes.OK).send(challenge);
};

/**
 * Inbound Messenger traffic.
 *
 * Meta requires a 200 within a few seconds and retries anything else, so the
 * acknowledgement goes out first and the work happens after. A message we
 * failed to file is a bug to fix in the logs — asking Meta to redeliver would
 * mean the same failure again, plus duplicates once it is fixed.
 */
const receiveWebhook = (req: Request & { rawBody?: Buffer }, res: Response) => {
  if (!verifySignature(req.rawBody, req.header("x-hub-signature-256"))) {
    res.status(StatusCodes.UNAUTHORIZED).send("Invalid signature");
    return;
  }

  res.status(StatusCodes.OK).send("EVENT_RECEIVED");

  const messages = parseInbound(req.body);

  void (async () => {
    for (const message of messages) {
      try {
        await ingestMessengerMessage(message);
      } catch (error) {
        console.error("[support] failed to ingest Messenger message", message.externalId, error);
      }
    }
  })();
};

export const SupportController = {
  me,
  agents,
  setPresence,
  heartbeat,
  stats,
  channels,
  queues,
  createQueue,
  deleteQueue,
  listConversations,
  getConversation,
  markRead,
  claim,
  transfer,
  setPriority,
  close,
  reopen,
  reply,
  typing,
  listTags,
  addTag,
  removeTag,
  upload,
  stream,
  health,
  verifyWebhook,
  receiveWebhook,
};
