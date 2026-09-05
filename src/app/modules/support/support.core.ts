/**
 * The pieces every part of the inbox needs: identity, ticket numbers, the audit
 * trail, and the shapes the API hands back.
 *
 * Kept separate from the service so the ingestion path (a Messenger webhook, a
 * Windee handoff) and the agent path (claiming, replying, closing) can share
 * them without importing each other.
 */

import {
  Prisma,
  SupportChannel,
  SupportConversationStatus,
  SupportEventType,
  SupportMessageAuthor,
} from "@prisma/client";

import prisma from "../../../shared/prisma";
import { publish } from "./support.realtime";

/** The queues that ship with the product. Names match the dashboard's sidebar. */
export const DEFAULT_QUEUES = [
  { name: "General Queue", slug: "general", sortOrder: 0 },
  { name: "Order Support", slug: "order", sortOrder: 1 },
  { name: "Product Support", slug: "product", sortOrder: 2 },
] as const;

/**
 * Creates the built-in queues once, on boot.
 *
 * Idempotent, so it is safe to run on every start: without at least one queue a
 * conversation would arrive with nowhere to sit.
 */
export const seedQueues = async () => {
  // Run one at a time rather than in a transaction: each upsert is already
  // idempotent on its own, so there is nothing to roll back, and holding a
  // transaction slot open during boot is exactly the thing that starves a
  // pooled connection when several processes start together.
  for (const queue of DEFAULT_QUEUES) {
    await prisma.supportQueue.upsert({
      where: { slug: queue.slug },
      // Names are editable, so an existing row is left exactly as the admin
      // set it; only the position is kept in step with the shipped order.
      update: { sortOrder: queue.sortOrder, isSystem: true },
      create: { ...queue, isSystem: true },
    });
  }
};

export const generalQueueId = async () => {
  const queue = await prisma.supportQueue.findUnique({ where: { slug: "general" } });
  return queue?.id ?? null;
};

/**
 * Next ticket reference, as `TKT-YYMMDD-0001`.
 *
 * The counter is per day and derived from a count rather than a sequence, so it
 * races under concurrent inserts. The unique index is the real guard: on a
 * collision we simply take the next number. Bounded retries — after a handful
 * of attempts something is wrong with the index, not with luck.
 */
export const nextTicketNo = async (): Promise<string> => {
  const now = new Date();
  const stamp = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const todayCount = await prisma.supportConversation.count({
    where: { createdAt: { gte: startOfDay } },
  });

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `TKT-${stamp}-${String(todayCount + 1 + attempt).padStart(4, "0")}`;
    const taken = await prisma.supportConversation.findUnique({
      where: { ticketNo: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  // Fall back to something that cannot collide rather than failing the message.
  return `TKT-${stamp}-${Date.now().toString().slice(-6)}`;
};

type ContactInput = {
  channel: SupportChannel;
  externalId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
  location?: string | null;
  userId?: string | null;
};

/** Last ten digits, matching how the order module compares phone numbers. */
const normalizePhone = (value: string) => value.replace(/\D/g, "").slice(-10);

/**
 * Finds or creates the person behind a conversation.
 *
 * Details are merged rather than overwritten: Messenger gives us a name and a
 * photo but never a phone, while the Windee widget gives a phone and a name the
 * visitor typed. Whichever arrives second must not blank the other.
 *
 * `userId` is only ever set from something we can actually prove — a signed-in
 * session, or a phone number that matches exactly one account. A guessed match
 * here would show one customer another customer's order history.
 */
export const upsertContact = async (input: ContactInput) => {
  const existing = await prisma.supportContact.findUnique({
    where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
  });

  let userId = input.userId ?? existing?.userId ?? null;

  if (!userId && input.phone) {
    const digits = normalizePhone(input.phone);
    if (digits.length >= 10) {
      const matches = await prisma.user.findMany({
        where: { isDeleted: false, orders: { some: { phone: { endsWith: digits } } } },
        select: { id: true },
        take: 2,
      });
      // Exactly one, or we do not know who this is.
      if (matches.length === 1) userId = matches[0].id;
    }
  }

  const merged = {
    name: input.name || existing?.name || null,
    email: input.email || existing?.email || null,
    phone: input.phone || existing?.phone || null,
    avatarUrl: input.avatarUrl || existing?.avatarUrl || null,
    locale: input.locale || existing?.locale || null,
    location: input.location || existing?.location || null,
    userId,
  };

  if (existing) {
    return prisma.supportContact.update({ where: { id: existing.id }, data: merged });
  }

  return prisma.supportContact.create({
    data: { channel: input.channel, externalId: input.externalId, ...merged },
  });
};

/** Trimmed one-liner for the conversation list. */
export const preview = (text: string, attachments = 0) => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat) return flat.slice(0, 140);
  return attachments > 0 ? "📎 Attachment" : "";
};

export const recordEvent = (
  conversationId: string,
  type: SupportEventType,
  actorId?: string | null,
  meta?: Prisma.InputJsonValue,
) =>
  prisma.supportEvent.create({
    data: { conversationId, type, actorId: actorId ?? null, meta },
  });

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const conversationListInclude = {
  contact: true,
  queue: true,
  assignedAgent: { include: { user: { select: { id: true, name: true, avatar: true } } } },
  tags: { include: { tag: true } },
} satisfies Prisma.SupportConversationInclude;

type ConversationWithRelations = Prisma.SupportConversationGetPayload<{
  include: typeof conversationListInclude;
}>;

export const shapeConversation = (row: ConversationWithRelations) => ({
  id: row.id,
  ticketNo: row.ticketNo,
  channel: row.channel,
  status: row.status,
  priority: row.priority,
  subject: row.subject,
  lastMessageAt: row.lastMessageAt,
  lastMessagePreview: row.lastMessagePreview,
  unreadForAgent: row.unreadForAgent,
  createdAt: row.createdAt,
  closedAt: row.closedAt,
  firstResponseAt: row.firstResponseAt,
  contact: {
    id: row.contact.id,
    name: row.contact.name ?? "Guest",
    email: row.contact.email,
    phone: row.contact.phone,
    avatarUrl: row.contact.avatarUrl,
    location: row.contact.location,
    userId: row.contact.userId,
  },
  queue: row.queue ? { id: row.queue.id, name: row.queue.name, slug: row.queue.slug } : null,
  assignedAgent: row.assignedAgent
    ? {
        id: row.assignedAgent.id,
        name: row.assignedAgent.user.name ?? "Agent",
        avatar: row.assignedAgent.user.avatar,
      }
    : null,
  tags: row.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
});

export type ShapedConversation = ReturnType<typeof shapeConversation>;

export const messageInclude = {
  agent: { include: { user: { select: { id: true, name: true, avatar: true } } } },
} satisfies Prisma.SupportMessageInclude;

/**
 * Structural rather than tied to a Prisma payload, so a caller that already
 * knows who the author is can shape a row without paying for a join. Loading
 * the agent relation back is a whole extra round trip to the database, and on
 * the reply path that is the very agent making the request.
 */
type MessageForShape = {
  id: string;
  author: SupportMessageAuthor;
  body: string;
  attachments: Prisma.JsonValue;
  isInternalNote: boolean;
  deliveredAt: Date | null;
  deliveryError: string | null;
  createdAt: Date;
  agent: { id: string; user: { name: string | null; avatar: string | null } } | null;
};

export const shapeMessage = (row: MessageForShape) => ({
  id: row.id,
  author: row.author,
  body: row.body,
  attachments: (row.attachments as unknown as Array<Record<string, string>>) ?? [],
  isInternalNote: row.isInternalNote,
  deliveredAt: row.deliveredAt,
  deliveryError: row.deliveryError,
  createdAt: row.createdAt,
  agent: row.agent
    ? { id: row.agent.id, name: row.agent.user.name ?? "Agent", avatar: row.agent.user.avatar }
    : null,
});

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Announces a conversation change to every open dashboard.
 *
 * Re-reads with the list include so subscribers receive the same shape the
 * conversation list renders — the client can drop it straight into its cache.
 */
export const broadcastConversation = async (
  conversationId: string,
  name: "conversation.created" | "conversation.updated" | "conversation.closed" = "conversation.updated",
) => {
  const row = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    include: conversationListInclude,
  });
  if (!row) return;

  publish({
    name,
    conversationId: row.id,
    chatSessionId: row.chatSessionId ?? undefined,
    payload: { conversation: shapeConversation(row) },
  });
};

export const broadcastMessage = (
  conversation: { id: string; chatSessionId: string | null },
  message: ReturnType<typeof shapeMessage>,
) => {
  publish({
    name: "message.created",
    conversationId: conversation.id,
    chatSessionId: conversation.chatSessionId ?? undefined,
    payload: { conversationId: conversation.id, message },
  });
};

/** True while the conversation is still somebody's problem. */
export const isOpen = (status: SupportConversationStatus) =>
  status !== SupportConversationStatus.CLOSED;

export const AUTHOR_LABEL: Record<SupportMessageAuthor, string> = {
  CUSTOMER: "Customer",
  AGENT: "Agent",
  BOT: "Windee",
  SYSTEM: "System",
};
