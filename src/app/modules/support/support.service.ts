/**
 * The support inbox, from the agent's side.
 *
 * Reading is deliberately cheap — the dashboard renders five panels at once, so
 * counts come from grouped aggregates rather than a query per row. Writing is
 * deliberately careful: claiming, transferring and closing all move work
 * between real people, so each one is guarded, audited and broadcast.
 */

import { StatusCodes } from "http-status-codes";
import {
  ChatRole,
  ChatSessionStatus,
  Prisma,
  SupportAgentPresence,
  SupportChannel,
  SupportConversationStatus,
  SupportEventType,
  SupportMessageAuthor,
  SupportPriority,
  UserRole,
} from "@prisma/client";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { optimizeAndSaveImage } from "../../utils/imageOptimizer";
import {
  broadcastConversation,
  broadcastMessage,
  conversationListInclude,
  messageInclude,
  preview,
  recordEvent,
  shapeConversation,
  shapeMessage,
} from "./support.core";
import { publish } from "./support.realtime";
import { isMessengerConfigured, sendSenderAction, sendText } from "./support.messenger";

/** Channels the dashboard lists. The later ones have no adapter yet. */
const ALL_CHANNELS: SupportChannel[] = [
  SupportChannel.WINDEE,
  SupportChannel.MESSENGER,
  SupportChannel.WHATSAPP,
  SupportChannel.INSTAGRAM,
  SupportChannel.EMAIL,
  SupportChannel.COMMENTS,
];

/** Only these two are actually connected to a provider today. */
const LIVE_CHANNELS = new Set<SupportChannel>([
  SupportChannel.WINDEE,
  SupportChannel.MESSENGER,
]);

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * The agent record for a signed-in member of staff, created on first use.
 *
 * Admins work the inbox too — they are the ones testing it before any agent is
 * hired — so both roles get a record rather than only CUSTOMER_SUPPORT.
 */
export const ensureAgent = async (userId: string) => {
  // Every support request begins here, and the database is remote — a round
  // trip costs ~280ms, so the query count *is* the latency. Prisma resolves an
  // `include` with a second query, which doubled the cost of the single most
  // called function in the module; this joins in one.
  //
  // Deliberately not cached: it is what authorises access to other people's
  // conversations, and a stale answer would keep a revoked account working.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      userId: string;
      presence: SupportAgentPresence;
      maxConcurrent: number;
      title: string | null;
      lastSeenAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      u_id: string;
      u_name: string | null;
      u_email: string | null;
      u_avatar: string | null;
      u_role: UserRole;
      u_isDeleted: boolean;
    }>
  >`
    SELECT a.id, a."userId", a.presence, a."maxConcurrent", a.title,
           a."lastSeenAt", a."createdAt", a."updatedAt",
           u.id AS u_id, u.name AS u_name, u.email AS u_email,
           u.avatar AS u_avatar, u.role AS u_role, u."isDeleted" AS u_isDeleted
    FROM support_agents a
    JOIN users u ON u.id = a."userId"
    WHERE a."userId" = ${userId}
    LIMIT 1
  `;

  const row = rows[0];

  const existing = row
    ? {
        id: row.id,
        userId: row.userId,
        presence: row.presence,
        maxConcurrent: row.maxConcurrent,
        title: row.title,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        user: {
          id: row.u_id,
          name: row.u_name,
          email: row.u_email,
          avatar: row.u_avatar,
          role: row.u_role,
          isDeleted: row.u_isDeleted,
        },
      }
    : null;

  if (existing) {
    if (existing.user.isDeleted) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Your account is no longer active.");
    }
    if (
      existing.user.role !== UserRole.CUSTOMER_SUPPORT &&
      existing.user.role !== UserRole.ADMIN
    ) {
      throw new ApiError(StatusCodes.FORBIDDEN, "You do not have access to the support inbox.");
    }
    return existing;
  }

  // First visit only: verify the account, then create the record.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...agentUserSelect, isDeleted: true },
  });

  if (!user || user.isDeleted) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Your account is no longer active.");
  }

  if (user.role !== UserRole.CUSTOMER_SUPPORT && user.role !== UserRole.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You do not have access to the support inbox.");
  }

  const created = await prisma.supportAgent.create({
    data: {
      userId,
      title: user.role === UserRole.ADMIN ? "Administrator" : "Support Agent",
      // A freshly created record means the agent just opened the dashboard.
      presence: SupportAgentPresence.AVAILABLE,
      lastSeenAt: new Date(),
    },
  });

  return { ...created, user };
};

const shapeAgent = (
  agent: Prisma.SupportAgentGetPayload<{
    include: { user: { select: { id: true; name: true; email: true; avatar: true; role: true } } };
  }>,
  openCount = 0,
) => ({
  id: agent.id,
  userId: agent.userId,
  name: agent.user.name ?? "Agent",
  email: agent.user.email,
  avatar: agent.user.avatar,
  role: agent.user.role,
  title: agent.title,
  presence: agent.presence,
  maxConcurrent: agent.maxConcurrent,
  lastSeenAt: agent.lastSeenAt,
  openConversations: openCount,
});

const agentUserSelect = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
} satisfies Prisma.UserSelect;

const agentInclude = {
  user: { select: agentUserSelect },
} satisfies Prisma.SupportAgentInclude;

export const getMe = async (userId: string) => {
  const agent = await ensureAgent(userId);
  const full = await prisma.supportAgent.findUniqueOrThrow({
    where: { id: agent.id },
    include: agentInclude,
  });

  const openCount = await prisma.supportConversation.count({
    where: { assignedAgentId: agent.id, status: SupportConversationStatus.WITH_AGENT },
  });

  return shapeAgent(full, openCount);
};

/** Everyone who can be transferred to, with their current load. */
export const listAgents = async () => {
  const agents = await prisma.supportAgent.findMany({
    include: agentInclude,
    orderBy: { createdAt: "asc" },
  });

  const load = await prisma.supportConversation.groupBy({
    by: ["assignedAgentId"],
    where: { status: SupportConversationStatus.WITH_AGENT },
    _count: { _all: true },
  });

  const byAgent = new Map(load.map((row) => [row.assignedAgentId, row._count._all]));

  return agents.map((agent) => shapeAgent(agent, byAgent.get(agent.id) ?? 0));
};

export const setPresence = async (userId: string, presence: SupportAgentPresence) => {
  const agent = await ensureAgent(userId);

  const updated = await prisma.supportAgent.update({
    where: { id: agent.id },
    data: { presence, lastSeenAt: new Date() },
    include: agentInclude,
  });

  publish({
    name: "agent.presence",
    payload: { agentId: updated.id, presence: updated.presence },
  });

  return shapeAgent(updated);
};

/** Keeps `lastSeenAt` fresh so a stale AVAILABLE can be spotted. */
export const heartbeat = async (userId: string) => {
  const agent = await ensureAgent(userId);
  await prisma.supportAgent.update({
    where: { id: agent.id },
    data: { lastSeenAt: new Date() },
  });
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Dashboard headline figures
// ---------------------------------------------------------------------------

/**
 * The five cards across the top.
 *
 * "Avg Response Time" measures first response — how long a customer waited
 * before a person answered, not how long the whole conversation took. That is
 * the number an agent can actually act on.
 */
export const getStats = async (userId: string) => {
  const agent = await ensureAgent(userId);
  const dayStart = startOfToday();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [openChats, inQueue, myChats, resolvedToday, resolvedYesterday, unreadConversations] =
    await Promise.all([
    prisma.supportConversation.count({
      where: { status: { not: SupportConversationStatus.CLOSED } },
    }),
    prisma.supportConversation.count({
      where: { status: SupportConversationStatus.IN_QUEUE },
    }),
    prisma.supportConversation.count({
      where: { assignedAgentId: agent.id, status: SupportConversationStatus.WITH_AGENT },
    }),
    prisma.supportConversation.count({
      where: { status: SupportConversationStatus.CLOSED, closedAt: { gte: dayStart } },
    }),
    prisma.supportConversation.count({
      where: {
        status: SupportConversationStatus.CLOSED,
        closedAt: {
          gte: new Date(dayStart.getTime() - 24 * 60 * 60 * 1000),
          lt: dayStart,
        },
      },
    }),

    // What is actually waiting on *this* agent: their own threads with new
    // customer lines, plus anything nobody has picked up. A global unread count
    // would badge work that is already somebody else's.
    prisma.supportConversation.count({
      where: {
        unreadForAgent: { gt: 0 },
        status: { not: SupportConversationStatus.CLOSED },
        OR: [{ assignedAgentId: agent.id }, { assignedAgentId: null }],
      },
    }),
  ]);

  // Prefer the last hour, as the card claims. An hour with no answered
  // conversations would read as a meaningless zero, so fall back to today.
  const responded = await prisma.supportConversation.findMany({
    where: { firstResponseAt: { gte: hourAgo } },
    select: { createdAt: true, firstResponseAt: true },
  });

  const sample = responded.length
    ? responded
    : await prisma.supportConversation.findMany({
        where: { firstResponseAt: { gte: dayStart } },
        select: { createdAt: true, firstResponseAt: true },
      });

  const avgResponseSeconds = sample.length
    ? Math.round(
        sample.reduce(
          (total, row) =>
            total + (row.firstResponseAt!.getTime() - row.createdAt.getTime()) / 1000,
          0,
        ) / sample.length,
      )
    : null;

  return {
    openChats,
    inQueue,
    myChats,
    unreadConversations,
    resolvedToday,
    /** Percentage change against the same count yesterday; null when there is no base. */
    resolvedTrend:
      resolvedYesterday > 0
        ? Math.round(((resolvedToday - resolvedYesterday) / resolvedYesterday) * 100)
        : null,
    avgResponseSeconds,
    avgResponseWindow: responded.length ? "hour" : "today",
  };
};

/** Sidebar counts. Every channel is listed, including the ones with no adapter. */
export const getChannels = async () => {
  const grouped = await prisma.supportConversation.groupBy({
    by: ["channel"],
    where: { status: { not: SupportConversationStatus.CLOSED } },
    _count: { _all: true },
  });

  const counts = new Map(grouped.map((row) => [row.channel, row._count._all]));

  return {
    total: grouped.reduce((sum, row) => sum + row._count._all, 0),
    channels: ALL_CHANNELS.map((channel) => ({
      channel,
      count: counts.get(channel) ?? 0,
      /**
       * False for the channels whose sections are in the dashboard but whose
       * adapters land in a later phase. The UI uses it to mark them as coming
       * soon rather than showing an empty inbox that looks broken.
       */
      connected:
        channel === SupportChannel.MESSENGER
          ? isMessengerConfigured()
          : LIVE_CHANNELS.has(channel),
    })),
  };
};

export const getQueues = async () => {
  const queues = await prisma.supportQueue.findMany({ orderBy: { sortOrder: "asc" } });

  const grouped = await prisma.supportConversation.groupBy({
    by: ["queueId"],
    where: { status: SupportConversationStatus.IN_QUEUE },
    _count: { _all: true },
  });

  const counts = new Map(grouped.map((row) => [row.queueId, row._count._all]));

  return {
    total: grouped.reduce((sum, row) => sum + row._count._all, 0),
    queues: queues.map((queue) => ({
      id: queue.id,
      name: queue.name,
      slug: queue.slug,
      description: queue.description,
      isSystem: queue.isSystem,
      count: counts.get(queue.id) ?? 0,
    })),
  };
};

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

export type ListFilters = {
  channel?: SupportChannel;
  queueId?: string;
  status?: SupportConversationStatus;
  /** "mine" — assigned to the caller; "unassigned" — nobody has claimed it. */
  scope?: "all" | "mine" | "unassigned";
  /** Only conversations with customer lines nobody has opened yet. */
  unread?: boolean;
  search?: string;
  sort?: "newest" | "oldest";
  page?: number;
  limit?: number;
};

export const listConversations = async (userId: string, filters: ListFilters) => {
  const agent = await ensureAgent(userId);

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));

  const where: Prisma.SupportConversationWhereInput = {
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.queueId ? { queueId: filters.queueId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.scope === "mine" ? { assignedAgentId: agent.id } : {}),
    ...(filters.scope === "unassigned" ? { assignedAgentId: null } : {}),
    // Composed under AND rather than as a bare OR: the search below also needs
    // an OR, and two of them on the same object would silently overwrite each
    // other — the unread filter would quietly stop applying whenever an agent
    // typed in the search box.
    ...(filters.unread
      ? {
          unreadForAgent: { gt: 0 },
          status: { not: SupportConversationStatus.CLOSED },
          AND: [{ OR: [{ assignedAgentId: agent.id }, { assignedAgentId: null }] }],
        }
      : {}),
  };

  const term = filters.search?.trim();
  if (term) {
    // Matches the things an agent actually has to hand: who it is, what they
    // said, and the reference from an email.
    where.OR = [
      { ticketNo: { contains: term, mode: "insensitive" } },
      { lastMessagePreview: { contains: term, mode: "insensitive" } },
      { subject: { contains: term, mode: "insensitive" } },
      { contact: { name: { contains: term, mode: "insensitive" } } },
      { contact: { email: { contains: term, mode: "insensitive" } } },
      { contact: { phone: { contains: term, mode: "insensitive" } } },
      { messages: { some: { body: { contains: term, mode: "insensitive" } } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.supportConversation.findMany({
      where,
      include: conversationListInclude,
      orderBy: { lastMessageAt: filters.sort === "oldest" ? "asc" : "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.supportConversation.count({ where }),
  ]);

  return { data: rows.map(shapeConversation), meta: { page, limit, total } };
};

// ---------------------------------------------------------------------------
// Conversation detail
// ---------------------------------------------------------------------------

const requireConversation = async (id: string) => {
  const conversation = await prisma.supportConversation.findUnique({
    where: { id },
    include: conversationListInclude,
  });

  if (!conversation) throw new ApiError(StatusCodes.NOT_FOUND, "Conversation not found.");
  return conversation;
};

/**
 * Where this ticket sits in its queue, and roughly how long that means waiting.
 *
 * The estimate is the recent average first response multiplied by the number of
 * people ahead — honest arithmetic on real numbers rather than a fixed
 * reassuring figure. Returns null rather than guessing when we have never
 * answered anything.
 */
const queuePosition = async (conversation: { id: string; queueId: string | null; createdAt: Date; status: SupportConversationStatus }) => {
  if (conversation.status !== SupportConversationStatus.IN_QUEUE) return null;

  const ahead = await prisma.supportConversation.count({
    where: {
      status: SupportConversationStatus.IN_QUEUE,
      queueId: conversation.queueId,
      createdAt: { lt: conversation.createdAt },
    },
  });

  const recent = await prisma.supportConversation.findMany({
    where: { firstResponseAt: { not: null } },
    select: { createdAt: true, firstResponseAt: true },
    orderBy: { firstResponseAt: "desc" },
    take: 20,
  });

  const avgSeconds = recent.length
    ? Math.round(
        recent.reduce(
          (total, row) => total + (row.firstResponseAt!.getTime() - row.createdAt.getTime()) / 1000,
          0,
        ) / recent.length,
      )
    : null;

  return {
    position: ahead + 1,
    estimatedWaitSeconds: avgSeconds === null ? null : avgSeconds * (ahead + 1),
  };
};

export const getConversation = async (userId: string, id: string) => {
  await ensureAgent(userId);
  const conversation = await requireConversation(id);

  const [messages, orders, previous] = await Promise.all([
    prisma.supportMessage.findMany({
      where: { conversationId: id },
      include: messageInclude,
      orderBy: { createdAt: "asc" },
    }),

    // Only when we know who the customer is. Guessing from a name would risk
    // showing somebody else's purchases.
    conversation.contact.userId
      ? prisma.order.findMany({
          where: { userId: conversation.contact.userId },
          select: {
            id: true,
            orderNo: true,
            orderStatus: true,
            totalAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : Promise.resolve([]),

    prisma.supportConversation.findMany({
      where: { contactId: conversation.contactId, id: { not: id } },
      select: {
        id: true,
        ticketNo: true,
        channel: true,
        status: true,
        lastMessageAt: true,
        lastMessagePreview: true,
      },
      orderBy: { lastMessageAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    conversation: shapeConversation(conversation),
    messages: messages.map(shapeMessage),
    customer: {
      ...shapeConversation(conversation).contact,
      recentOrders: orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        status: order.orderStatus,
        total: order.totalAmount,
        placedAt: order.createdAt,
      })),
    },
    previousConversations: previous,
    queue: await queuePosition(conversation),
  };
};

/** Clears the unread badge once the agent has the thread on screen. */
export const markRead = async (userId: string, id: string) => {
  await ensureAgent(userId);
  await prisma.supportConversation.update({ where: { id }, data: { unreadForAgent: 0 } });
  await broadcastConversation(id);
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * "Start Chat" — takes the conversation out of the queue.
 *
 * The update is conditional on the row still being unassigned, so two agents
 * clicking at the same moment cannot both win: the loser's update matches no
 * rows and they are told who got there first.
 */
export const claimConversation = async (userId: string, id: string) => {
  const agent = await ensureAgent(userId);
  const conversation = await requireConversation(id);

  if (conversation.status === SupportConversationStatus.CLOSED) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This conversation is closed.");
  }

  if (conversation.assignedAgentId && conversation.assignedAgentId !== agent.id) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `${conversation.assignedAgent?.user.name ?? "Another agent"} is already handling this conversation.`,
    );
  }

  const { count } = await prisma.supportConversation.updateMany({
    where: { id, OR: [{ assignedAgentId: null }, { assignedAgentId: agent.id }] },
    data: { assignedAgentId: agent.id, status: SupportConversationStatus.WITH_AGENT },
  });

  if (count === 0) {
    throw new ApiError(StatusCodes.CONFLICT, "Another agent just picked this up.");
  }

  await recordEvent(id, SupportEventType.ASSIGNED, agent.id);
  await systemLine(id, `Assigned to ${(await agentName(agent.id)) ?? "an agent"}.`);

  // Let the customer know a person is on it, on the channels that can say so.
  await notifyCustomerOfHandoff(conversation);

  await broadcastConversation(id);
  return getConversation(userId, id);
};

/** Moves a conversation to another agent, another queue, or back to the queue. */
export const transferConversation = async (
  userId: string,
  id: string,
  target: { agentId?: string | null; queueId?: string | null; note?: string },
) => {
  const actor = await ensureAgent(userId);
  const conversation = await requireConversation(id);

  if (conversation.status === SupportConversationStatus.CLOSED) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This conversation is closed.");
  }

  if (target.agentId) {
    const exists = await prisma.supportAgent.findUnique({ where: { id: target.agentId } });
    if (!exists) throw new ApiError(StatusCodes.NOT_FOUND, "That agent no longer exists.");
  }

  if (target.queueId) {
    const exists = await prisma.supportQueue.findUnique({ where: { id: target.queueId } });
    if (!exists) throw new ApiError(StatusCodes.NOT_FOUND, "That queue no longer exists.");
  }

  const assignedAgentId = target.agentId ?? null;

  await prisma.supportConversation.update({
    where: { id },
    data: {
      assignedAgentId,
      queueId: target.queueId ?? conversation.queueId,
      // Handing back without naming an agent returns it to the queue for
      // anyone to take, which is the point of transferring to a queue.
      status: assignedAgentId
        ? SupportConversationStatus.WITH_AGENT
        : SupportConversationStatus.IN_QUEUE,
    },
  });

  await recordEvent(id, SupportEventType.TRANSFERRED, actor.id, {
    from: conversation.assignedAgentId,
    toAgent: assignedAgentId,
    toQueue: target.queueId ?? null,
    note: target.note ?? null,
  });

  const destination = assignedAgentId
    ? ((await agentName(assignedAgentId)) ?? "another agent")
    : "the queue";
  await systemLine(id, `Transferred to ${destination}${target.note ? ` — ${target.note}` : ""}.`);

  await broadcastConversation(id);
  return getConversation(userId, id);
};

export const setPriority = async (userId: string, id: string, priority: SupportPriority) => {
  const agent = await ensureAgent(userId);
  const conversation = await requireConversation(id);

  await prisma.supportConversation.update({ where: { id }, data: { priority } });
  await recordEvent(id, SupportEventType.PRIORITY_CHANGED, agent.id, {
    from: conversation.priority,
    to: priority,
  });

  await broadcastConversation(id);
  return { id, priority };
};

/**
 * Ends the conversation.
 *
 * The Windee widget is told too, so a visitor still sitting on the page is
 * returned to the bot rather than typing into a thread nobody is reading.
 */
export const closeConversation = async (userId: string, id: string, reason?: string) => {
  const agent = await ensureAgent(userId);
  const conversation = await requireConversation(id);

  if (conversation.status === SupportConversationStatus.CLOSED) {
    return getConversation(userId, id);
  }

  await prisma.supportConversation.update({
    where: { id },
    data: {
      status: SupportConversationStatus.CLOSED,
      closedAt: new Date(),
      closedById: agent.id,
      unreadForAgent: 0,
    },
  });

  await recordEvent(id, SupportEventType.CLOSED, agent.id, reason ? { reason } : undefined);
  await systemLine(id, reason ? `Closed — ${reason}` : "Conversation closed.");

  if (conversation.chatSessionId) {
    // Hand the visitor back to Windee rather than leaving them on a dead thread.
    await prisma.chatSession
      .update({
        where: { id: conversation.chatSessionId },
        data: { status: ChatSessionStatus.ACTIVE },
      })
      .catch(() => {
        /* the visitor may have already closed the widget, which deletes it */
      });
  }

  await broadcastConversation(id, "conversation.closed");
  return getConversation(userId, id);
};

export const reopenConversation = async (userId: string, id: string) => {
  const agent = await ensureAgent(userId);
  const conversation = await requireConversation(id);

  if (conversation.status !== SupportConversationStatus.CLOSED) {
    return getConversation(userId, id);
  }

  await prisma.supportConversation.update({
    where: { id },
    data: {
      status: conversation.assignedAgentId
        ? SupportConversationStatus.WITH_AGENT
        : SupportConversationStatus.IN_QUEUE,
      closedAt: null,
      closedById: null,
    },
  });

  await recordEvent(id, SupportEventType.REOPENED, agent.id);
  await broadcastConversation(id);
  return getConversation(userId, id);
};

// ---------------------------------------------------------------------------
// Replying
// ---------------------------------------------------------------------------

const agentName = async (agentId: string) => {
  const agent = await prisma.supportAgent.findUnique({
    where: { id: agentId },
    include: { user: { select: { name: true } } },
  });
  return agent?.user.name ?? null;
};

/** A centred, non-delivered note in the transcript — assignment, transfer, close. */
const systemLine = async (conversationId: string, body: string) => {
  const message = await prisma.supportMessage.create({
    data: { conversationId, author: SupportMessageAuthor.SYSTEM, body },
    include: messageInclude,
  });

  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, chatSessionId: true },
  });

  if (conversation) broadcastMessage(conversation, shapeMessage(message));
  return message;
};

/**
 * Tells the customer a person has joined, on channels where that is meaningful.
 *
 * Messenger gets a read receipt rather than a message — an automated "an agent
 * has joined" followed by silence is worse than nothing. The widget gets a real
 * line because its UI is otherwise showing a queue notice.
 */
const notifyCustomerOfHandoff = async (conversation: { chatSessionId: string | null; externalId: string | null; channel: SupportChannel }) => {
  if (conversation.channel === SupportChannel.MESSENGER && conversation.externalId) {
    await sendSenderAction(conversation.externalId, "mark_seen");
    return;
  }

  if (conversation.channel === SupportChannel.WINDEE && conversation.chatSessionId) {
    await prisma.chatMessage
      .create({
        data: {
          sessionId: conversation.chatSessionId,
          role: ChatRole.ASSISTANT,
          content: "You're connected to our support team now.",
          data: { kind: "agent-joined" } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        /* widget closed */
      });
  }
};

export type ReplyInput = {
  body: string;
  attachments?: Array<{ url: string; name: string; mime: string; size?: number }>;
  isInternalNote?: boolean;
};

/**
 * Sends an agent's reply out on whichever channel the conversation arrived on.
 *
 * The order matters: the message is delivered to the provider *before* it is
 * stored as delivered. A transcript that shows a reply the customer never got
 * is worse than an error — the agent would move on believing they had answered.
 * When delivery fails the line is still saved, flagged with the reason, so the
 * agent can see what happened and retry.
 */
export const sendReply = async (userId: string, id: string, input: ReplyInput) => {
  // The two lookups this path genuinely needs, run together rather than one
  // after the other. `requireConversation` loads contact, queue, agent and
  // tags for the inbox list; none of that is used here, so this reads only the
  // handful of columns the send actually depends on.
  const [agent, conversation] = await Promise.all([
    ensureAgent(userId),
    prisma.supportConversation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        channel: true,
        externalId: true,
        chatSessionId: true,
        assignedAgentId: true,
        firstResponseAt: true,
      },
    }),
  ]);

  if (!conversation) throw new ApiError(StatusCodes.NOT_FOUND, "Conversation not found.");

  const body = input.body.trim();
  if (!body && !input.attachments?.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Write something before sending.");
  }

  if (conversation.status === SupportConversationStatus.CLOSED && !input.isInternalNote) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This conversation is closed. Reopen it to reply.",
    );
  }

  // An agent replying to a queued conversation is claiming it; making them
  // press two buttons to do one thing helps nobody.
  if (!input.isInternalNote && !conversation.assignedAgentId) {
    await prisma.supportConversation.updateMany({
      where: { id, assignedAgentId: null },
      data: { assignedAgentId: agent.id, status: SupportConversationStatus.WITH_AGENT },
    });
    await recordEvent(id, SupportEventType.ASSIGNED, agent.id);

    // The customer is told a person joined however the assignment happened.
    // Announcing it only from the Start Chat button meant an agent who simply
    // typed a reply left them still watching the queue card.
    await notifyCustomerOfHandoff(conversation);
  }

  let externalId: string | null = null;
  let deliveryError: string | null = null;

  if (!input.isInternalNote) {
    try {
      if (conversation.channel === SupportChannel.MESSENGER && conversation.externalId) {
        externalId = await sendText(conversation.externalId, body);
      } else if (conversation.channel === SupportChannel.WINDEE && conversation.chatSessionId) {
        // The widget reads the Windee transcript, so an agent reply is written
        // there as well. `data.kind` lets the client badge it as a person
        // rather than the bot; a client that ignores it still shows the text.
        await prisma.chatMessage.create({
          data: {
            sessionId: conversation.chatSessionId,
            role: ChatRole.ASSISTANT,
            content: body,
            data: {
              kind: "agent",
              // Already loaded with the agent — looking the name up again here
              // was a round trip on the critical path of every single reply.
              agentName: agent.user.name ?? "Support",
            } as Prisma.InputJsonValue,
          },
        });
      } else if (!LIVE_CHANNELS.has(conversation.channel)) {
        throw new ApiError(
          StatusCodes.NOT_IMPLEMENTED,
          `${conversation.channel} replies are not connected yet.`,
        );
      }
    } catch (error) {
      deliveryError =
        error instanceof ApiError ? error.message : "Could not deliver the message.";
    }
  }

  const now = new Date();

  // Two independent writes, issued together. No relation include on the
  // message: the author is the agent making this very request, so their name
  // and avatar are already in hand and joining them back costs another trip.
  const [message] = await Promise.all([
    prisma.supportMessage.create({
      data: {
        conversationId: id,
        author: SupportMessageAuthor.AGENT,
        agentId: agent.id,
        body,
        attachments: input.attachments?.length
          ? (input.attachments as unknown as Prisma.InputJsonValue)
          : undefined,
        isInternalNote: Boolean(input.isInternalNote),
        externalId,
        deliveredAt: input.isInternalNote || deliveryError ? null : now,
        deliveryError,
      },
    }),
    prisma.supportConversation.update({
      where: { id },
      data: {
        // An internal note is not something the customer said or saw, so it must
        // not become the preview or reset the unread badge.
        ...(input.isInternalNote
          ? {}
          : {
              lastMessageAt: now,
              lastMessagePreview: preview(body, input.attachments?.length ?? 0),
              unreadForAgent: 0,
              ...(conversation.firstResponseAt ? {} : { firstResponseAt: now }),
            }),
      },
    }),
  ]);

  const shaped = shapeMessage({
    ...message,
    agent: { id: agent.id, user: { name: agent.user.name, avatar: agent.user.avatar } },
  });

  broadcastMessage(conversation, shaped);

  // Fanned out after the reply is already on its way back. Subscribers need the
  // conversation re-read with every relation the inbox list renders, and making
  // the agent who sent the message wait for other people's screens to update is
  // the wrong trade.
  void broadcastConversation(id).catch((error) =>
    console.error("[support] failed to broadcast conversation", id, error),
  );

  if (deliveryError) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, deliveryError);
  }

  return shaped;
};

/** Drives the "…" bubble on the customer's side. Cosmetic and best-effort. */
export const setTyping = async (userId: string, id: string, on: boolean) => {
  await ensureAgent(userId);
  const conversation = await requireConversation(id);

  if (conversation.channel === SupportChannel.MESSENGER && conversation.externalId) {
    await sendSenderAction(conversation.externalId, on ? "typing_on" : "typing_off");
  }

  publish({
    name: "typing",
    conversationId: id,
    chatSessionId: conversation.chatSessionId ?? undefined,
    payload: { conversationId: id, from: "agent", on },
  });

  return { ok: true };
};

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const listTags = () => prisma.supportTag.findMany({ orderBy: { name: "asc" } });

export const addTag = async (userId: string, id: string, name: string) => {
  const agent = await ensureAgent(userId);
  await requireConversation(id);

  const clean = name.trim();
  if (!clean) throw new ApiError(StatusCodes.BAD_REQUEST, "A tag needs a name.");

  const tag = await prisma.supportTag.upsert({
    where: { name: clean },
    update: {},
    create: { name: clean },
  });

  await prisma.supportConversationTag.upsert({
    where: { conversationId_tagId: { conversationId: id, tagId: tag.id } },
    update: {},
    create: { conversationId: id, tagId: tag.id },
  });

  await recordEvent(id, SupportEventType.TAGGED, agent.id, { tag: clean });
  await broadcastConversation(id);

  return tag;
};

export const removeTag = async (userId: string, id: string, tagId: string) => {
  const agent = await ensureAgent(userId);

  await prisma.supportConversationTag
    .delete({ where: { conversationId_tagId: { conversationId: id, tagId } } })
    .catch(() => {
      /* already gone */
    });

  await recordEvent(id, SupportEventType.UNTAGGED, agent.id, { tagId });
  await broadcastConversation(id);

  return { ok: true };
};

// ---------------------------------------------------------------------------
// Queue administration (admin only, enforced at the route)
// ---------------------------------------------------------------------------

export const createQueue = async (name: string, description?: string) => {
  const clean = name.trim();
  if (!clean) throw new ApiError(StatusCodes.BAD_REQUEST, "A queue needs a name.");

  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const taken = await prisma.supportQueue.findFirst({
    where: { OR: [{ name: clean }, { slug }] },
  });
  if (taken) throw new ApiError(StatusCodes.CONFLICT, "That queue already exists.");

  const last = await prisma.supportQueue.findFirst({ orderBy: { sortOrder: "desc" } });

  return prisma.supportQueue.create({
    data: { name: clean, slug, description, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
};

export const deleteQueue = async (id: string) => {
  const queue = await prisma.supportQueue.findUnique({
    where: { id },
    include: { _count: { select: { conversations: true } } },
  });

  if (!queue) throw new ApiError(StatusCodes.NOT_FOUND, "Queue not found.");

  if (queue.isSystem) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Built-in queues cannot be deleted.");
  }

  if (queue._count.conversations > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `${queue._count.conversations} conversation(s) are in this queue. Move them first.`,
    );
  }

  await prisma.supportQueue.delete({ where: { id } });
  return { deleted: true };
};

/**
 * Stores a file an agent attached to a reply.
 *
 * Returns a path rather than an absolute URL, matching the chat uploader: the
 * client serves `/uploads` through its own rewrite, and an absolute URL to the
 * API host trips helmet's cross-origin resource policy.
 */
export const uploadAttachment = async (userId: string, file: Express.Multer.File) => {
  await ensureAgent(userId);
  const filename = await optimizeAndSaveImage(file, "support");

  return {
    url: `/uploads/support/${filename}`,
    name: file.originalname,
    mime: file.mimetype,
    size: file.size,
  };
};

export const SupportService = {
  ensureAgent,
  uploadAttachment,
  getMe,
  listAgents,
  setPresence,
  heartbeat,
  getStats,
  getChannels,
  getQueues,
  listConversations,
  getConversation,
  markRead,
  claimConversation,
  transferConversation,
  setPriority,
  closeConversation,
  reopenConversation,
  sendReply,
  setTyping,
  listTags,
  addTag,
  removeTag,
  createQueue,
  deleteQueue,
};
