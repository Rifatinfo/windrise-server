import { ChatRole, ChatSessionStatus, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { optimizeAndSaveImage } from "../../utils/imageOptimizer";
import {
  complete,
  isConfigured,
  type ChatMessageParam,
  type ToolCall,
} from "./chatbot.ai";
import { attachmentAsDataUrl } from "./chatbot.image";
import { HUMAN_HANDOFF_MESSAGE, buildSystemPrompt } from "./chatbot.prompt";
import { TOOLS, commitPending, runTool, type PendingAction } from "./chatbot.tools";
import {
  handoffWindeeSession,
  ingestWindeeCustomerMessage,
  endSupportForVisitor,
} from "../support/support.ingest";

/**
 * How much of the transcript is replayed to the model each turn. Long threads
 * are trimmed from the front so cost stays bounded; the system prompt and the
 * captured name/phone carry the context that matters.
 */
const HISTORY_LIMIT = 24;

type SessionOwner = { visitorId: string; userId?: string; userEmail?: string };

/**
 * What the widget needs to know about the human side of a handed-off chat.
 *
 * `HANDED_OFF` on its own is too coarse for the UI: waiting in a queue and
 * actually talking to someone look completely different to the customer — one
 * disables the composer, the other names the person answering.
 */
const supportState = async (chatSessionId: string) => {
  const conversation = await prisma.supportConversation.findUnique({
    where: { chatSessionId },
    include: { assignedAgent: { include: { user: { select: { name: true, avatar: true } } } } },
  });

  if (!conversation || conversation.status === "CLOSED") return null;

  const connected = conversation.status === "WITH_AGENT" && Boolean(conversation.assignedAgent);

  // Only claim the team is "assisting other customers" when somebody really is
  // at their desk. Otherwise the honest line is that nobody is online, and the
  // widget says so instead.
  const agentsAvailable =
    (await prisma.supportAgent.count({ where: { presence: "AVAILABLE" } })) > 0;

  return {
    state: connected ? ("CONNECTED" as const) : ("QUEUED" as const),
    agentName: conversation.assignedAgent?.user.name ?? null,
    agentAvatar: conversation.assignedAgent?.user.avatar ?? null,
    agentsAvailable,
    ticketNo: conversation.ticketNo,
  };
};

const shapeMessage = (row: {
  id: string;
  role: ChatRole;
  content: string;
  data: Prisma.JsonValue;
  imageUrl: string | null;
  createdAt: Date;
}) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  card: row.data ?? null,
  imageUrl: row.imageUrl,
  createdAt: row.createdAt.toISOString(),
});

/**
 * What the customer should see.
 *
 * Tool results never appear, and neither do the assistant turns that only
 * carried tool calls — those have no prose and would render as empty bubbles.
 */
const isVisible = (row: { role: ChatRole; content: string }) =>
  row.role !== ChatRole.TOOL && row.content.trim().length > 0;

/** Loads a session and proves the caller owns it. */
const requireSession = async (sessionId: string, visitorId: string) => {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });

  // A visitor id is the only credential a guest has, so a mismatch is treated
  // as "no such session" rather than confirming that the id exists.
  if (!session || session.visitorId !== visitorId) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Chat session not found");
  }
  if (session.status === ChatSessionStatus.CLOSED) {
    throw new ApiError(StatusCodes.GONE, "This chat has been closed");
  }

  return session;
};

/**
 * Opens a chat, or hands back the one this visitor already has open.
 *
 * Reusing the active session is what makes minimise-and-return work: the
 * widget calls this on mount and gets its transcript back.
 */
const startSession = async (
  payload: { name?: string; phone?: string },
  owner: SessionOwner,
) => {
  const existing = await prisma.chatSession.findFirst({
    where: { visitorId: owner.visitorId, status: { not: ChatSessionStatus.CLOSED } },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (existing) {
    // Details typed on the welcome screen this time round win.
    const session =
      payload.name || payload.phone
        ? await prisma.chatSession.update({
            where: { id: existing.id },
            data: {
              name: payload.name ?? existing.name,
              phone: payload.phone ?? existing.phone,
              userId: owner.userId ?? existing.userId,
            },
          })
        : existing;

    return {
      sessionId: session.id,
      name: session.name,
      phone: session.phone,
      status: session.status,
      support: await supportState(session.id),
      resumed: true,
      messages: existing.messages.filter(isVisible).map(shapeMessage),
    };
  }

  const session = await prisma.chatSession.create({
    data: {
      visitorId: owner.visitorId,
      userId: owner.userId ?? null,
      name: payload.name ?? null,
      phone: payload.phone ?? null,
    },
  });

  return {
    sessionId: session.id,
    name: session.name,
    phone: session.phone,
    status: session.status,
    support: null,
    resumed: false,
    messages: [],
  };
};

const getSession = async (sessionId: string, visitorId: string) => {
  const session = await requireSession(sessionId, visitorId);
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return {
    sessionId: session.id,
    name: session.name,
    phone: session.phone,
    status: session.status,
    support: await supportState(session.id),
    messages: messages.filter(isVisible).map(shapeMessage),
  };
};

/**
 * Rebuilds the model's view of the conversation from what was persisted —
 * tool calls and their results included.
 *
 * Replaying only the prose loses every identifier the model was holding (the
 * product it had picked, the order draft awaiting a yes), so it re-derives
 * them and repeats work. The full turns go back in, in order.
 */
const buildThread = async (
  sessionId: string,
  session: { name: string | null; phone: string | null },
): Promise<ChatMessageParam[]> => {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });

  const ordered = rows.reverse();

  // The window may have cut between an assistant turn and the tool results
  // answering it. A `tool` message with no preceding `tool_calls` is rejected
  // by the API, so any orphans at the front are dropped.
  while (ordered.length && ordered[0].role === ChatRole.TOOL) ordered.shift();

  const thread: ChatMessageParam[] = [
    { role: "system", content: buildSystemPrompt(session) },
  ];

  for (const row of ordered) {
    if (row.role === ChatRole.TOOL) {
      thread.push({
        role: "tool",
        tool_call_id: row.toolCallId ?? row.id,
        content: row.content,
      });
      continue;
    }

    if (row.role === ChatRole.ASSISTANT) {
      const toolCalls = row.toolCalls as ToolCall[] | null;
      thread.push({
        role: "assistant",
        content: row.content || null,
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // An attached image goes alongside the text as a vision content part,
    // inlined rather than linked — see `attachmentAsDataUrl`.
    if (row.imageUrl) {
      const dataUrl = await attachmentAsDataUrl(row.imageUrl);

      thread.push({
        role: "user",
        content: dataUrl
          ? [
              {
                type: "text",
                text:
                  row.content ||
                  "Here's a photo. What is this, and do you have anything like it?",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ]
          : // The file has gone; say so rather than silently answering as if
            // no image was ever sent.
            `${row.content || "I attached a photo"} (the image could not be loaded)`,
      });
      continue;
    }

    thread.push({ role: "user", content: row.content });
  }

  return thread;
};

const sendMessage = async (
  payload: { sessionId: string; text: string; imageUrl?: string | null },
  owner: SessionOwner,
) => {
  const session = await requireSession(payload.sessionId, owner.visitorId);

  // Handed off to a person: the visitor is talking to an agent, so the message
  // goes to the support inbox and Windee stays quiet. Answering over the top of
  // a human would be confusing at best and contradict them at worst.
  if (session.status === ChatSessionStatus.HANDED_OFF) {
    const mine = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatRole.USER,
        content: payload.text,
        imageUrl: payload.imageUrl ?? null,
      },
    });

    await ingestWindeeCustomerMessage(session.id, payload.text, payload.imageUrl);
    return shapeMessage(mine);
  }

  if (!isConfigured()) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      "Windee isn't available right now.",
    );
  }

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: ChatRole.USER,
      content: payload.text,
      imageUrl: payload.imageUrl ?? null,
    },
  });

  const thread = await buildThread(session.id, session);

  const { text, cards, turns } = await complete(
    thread,
    TOOLS,
    runTool({
      sessionId: session.id,
      userId: session.userId ?? undefined,
      userEmail: owner.userEmail,
    }),
  );

  // Persisted in order and never shown to the customer: this is what lets the
  // next turn pick up mid-task instead of starting the order over.
  for (const turn of turns) {
    if (turn.role === "assistant") {
      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: ChatRole.ASSISTANT,
          content: turn.content ?? "",
          toolCalls: (turn.tool_calls ?? []) as unknown as Prisma.InputJsonValue,
        },
      });
      continue;
    }

    if (turn.role === "tool") {
      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: ChatRole.TOOL,
          content: turn.content.slice(0, 8000),
          toolCallId: turn.tool_call_id,
        },
      });
    }
  }

  const reply = await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: ChatRole.ASSISTANT,
      content: text,
      // The last card wins; a turn that produced several is rare and the most
      // recent is the one the reply is talking about.
      data: cards.length ? (cards[cards.length - 1].data as Prisma.InputJsonValue) : undefined,
    },
  });

  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });

  return shapeMessage(reply);
};

/**
 * Carries out the order or cancellation the customer just approved.
 *
 * The stored payload is executed as-is, so what runs is exactly what was
 * priced and shown on screen — not a re-reading of the conversation. The
 * pending action is cleared first, which makes a double-tap on Confirm a
 * no-op rather than a second order.
 */
const confirmPending = async (sessionId: string, owner: SessionOwner) => {
  const session = await requireSession(sessionId, owner.visitorId);
  const pending = session.pendingAction as PendingAction | null;

  if (!pending) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "There's nothing waiting to be confirmed.");
  }

  await prisma.chatSession.update({
    where: { id: session.id },
    data: { pendingAction: Prisma.DbNull },
  });

  const outcome = await commitPending(pending, {
    userId: session.userId ?? undefined,
    userEmail: owner.userEmail,
  });

  // Phrased around what actually came back: an order number or total that the
  // service did not return is left out rather than printed as blank or ৳0.
  const reference = outcome.orderNo ? ` ${outcome.orderNo}` : "";

  const text =
    outcome.kind === "order-placed"
      ? outcome.total
        ? `Done — your order${reference} is placed. You'll pay ৳${Math.round(outcome.total)} on delivery.`
        : `Done — your order${reference} is placed. You'll pay on delivery.`
      : `Your order${reference} has been cancelled.`;

  const message = await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: ChatRole.ASSISTANT,
      content: text,
      data: outcome as unknown as Prisma.InputJsonValue,
    },
  });

  return shapeMessage(message);
};

/** Drops a proposal the customer decided against. */
const declinePending = async (sessionId: string, visitorId: string) => {
  const session = await requireSession(sessionId, visitorId);

  await prisma.chatSession.update({
    where: { id: session.id },
    data: { pendingAction: Prisma.DbNull },
  });

  const message = await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: ChatRole.ASSISTANT,
      content: "No problem — I've left that as it was. Anything else I can help with?",
    },
  });

  return shapeMessage(message);
};

/**
 * Asks for a person.
 *
 * Raises a support ticket and copies the bot transcript across, so the agent
 * opens a thread already knowing what was asked — being made to repeat yourself
 * to a second responder is the whole reason handoffs feel bad. The reply the
 * visitor sees stays honest about the wait: it promises someone will pick it
 * up, not that someone already has.
 */
const requestHuman = async (sessionId: string, visitorId: string) => {
  const session = await requireSession(sessionId, visitorId);

  await prisma.chatSession.update({
    where: { id: session.id },
    data: { status: ChatSessionStatus.HANDED_OFF },
  });

  await handoffWindeeSession(session.id);

  const message = await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: ChatRole.ASSISTANT,
      content: HUMAN_HANDOFF_MESSAGE,
      data: { kind: "handoff" } as Prisma.InputJsonValue,
    },
  });

  return shapeMessage(message);
};

/**
 * Back to Windee — the widget's "End chat".
 *
 * Closes the support ticket as well as flipping the session back. Leaving it
 * open would strand the conversation in an agent's inbox with a customer who
 * has already walked away, and would count against the queue for everyone else.
 */
const resumeAi = async (sessionId: string, visitorId: string) => {
  const session = await requireSession(sessionId, visitorId);

  await endSupportForVisitor(session.id);

  await prisma.chatSession.update({
    where: { id: session.id },
    data: { status: ChatSessionStatus.ACTIVE },
  });

  return { sessionId: session.id, status: ChatSessionStatus.ACTIVE };
};

/**
 * Ends the chat and erases it.
 *
 * Closing is destructive by design — the transcript is deleted outright rather
 * than flagged, so nothing the customer typed outlives the conversation.
 * Messages go with it through the cascade on the relation.
 */
const closeSession = async (sessionId: string, visitorId: string) => {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });

  // Idempotent: closing an already-deleted chat is a success, not a 404, so a
  // double click or a retry on a flaky connection cannot surface an error.
  if (!session || session.visitorId !== visitorId) return { deleted: false };

  await prisma.chatSession.delete({ where: { id: sessionId } });
  return { deleted: true };
};

const uploadImage = async (file: Express.Multer.File) => {
  const filename = await optimizeAndSaveImage(file, "chat");
  return { url: `/uploads/chat/${filename}` };
};

export const ChatbotService = {
  startSession,
  confirmPending,
  declinePending,
  getSession,
  sendMessage,
  requestHuman,
  resumeAi,
  closeSession,
  uploadImage,
};
