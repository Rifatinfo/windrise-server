/**
 * Everything that puts a *customer's* words into the inbox.
 *
 * Two sources today — a Messenger webhook and a Windee handoff — and both end
 * at the same place: a `SupportConversation` sitting in a queue with a
 * transcript an agent can read. Agent-side actions live in the service; this
 * file only ever writes on the customer's behalf.
 */

import {
  ChatRole,
  Prisma,
  SupportChannel,
  SupportConversationStatus,
  SupportEventType,
  SupportMessageAuthor,
} from "@prisma/client";

import prisma from "../../../shared/prisma";
import {
  broadcastConversation,
  broadcastMessage,
  generalQueueId,
  messageInclude,
  nextTicketNo,
  preview,
  recordEvent,
  shapeMessage,
  upsertContact,
} from "./support.core";
import type { InboundMessage } from "./support.messenger";
import { fetchProfile } from "./support.messenger";

/**
 * The conversation a new customer message belongs to.
 *
 * An open thread is continued; anything else starts a fresh ticket. Reopening a
 * closed conversation would quietly reset a resolved-today count and hide the
 * new question at the bottom of an old transcript, so a closed thread stays
 * closed and the customer's next message gets its own reference.
 */
const openConversationFor = async (contactId: string, channel: SupportChannel) =>
  prisma.supportConversation.findFirst({
    where: { contactId, channel, status: { not: SupportConversationStatus.CLOSED } },
    orderBy: { lastMessageAt: "desc" },
  });

type CreateConversationInput = {
  channel: SupportChannel;
  contactId: string;
  externalId?: string | null;
  chatSessionId?: string | null;
  subject?: string | null;
};

const createConversation = async (input: CreateConversationInput) => {
  const conversation = await prisma.supportConversation.create({
    data: {
      ticketNo: await nextTicketNo(),
      channel: input.channel,
      contactId: input.contactId,
      externalId: input.externalId ?? null,
      chatSessionId: input.chatSessionId ?? null,
      subject: input.subject ?? null,
      queueId: await generalQueueId(),
      status: SupportConversationStatus.IN_QUEUE,
    },
  });

  await recordEvent(conversation.id, SupportEventType.CREATED);
  return conversation;
};

type AppendInput = {
  conversationId: string;
  author: SupportMessageAuthor;
  body: string;
  attachments?: Prisma.InputJsonValue;
  externalId?: string | null;
  createdAt?: Date;
  /** Bot replay lines should not light up the unread badge. */
  countsAsUnread?: boolean;
};

/**
 * Writes one customer/bot line and keeps the conversation's denormalised
 * summary in step, in a single transaction so the list can never show a preview
 * for a message that failed to save.
 */
const appendInbound = async (input: AppendInput) => {
  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: {
        conversationId: input.conversationId,
        author: input.author,
        body: input.body,
        attachments: input.attachments,
        externalId: input.externalId ?? null,
        createdAt: input.createdAt ?? new Date(),
      },
      include: messageInclude,
    }),
    prisma.supportConversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: input.createdAt ?? new Date(),
        lastMessagePreview: preview(input.body, input.attachments ? 1 : 0),
        ...(input.countsAsUnread === false ? {} : { unreadForAgent: { increment: 1 } }),
      },
    }),
  ]);

  return message;
};

// ---------------------------------------------------------------------------
// Messenger
// ---------------------------------------------------------------------------

/**
 * Files one Messenger message.
 *
 * Meta retries any delivery it did not get a 200 for, so the same `mid` can
 * arrive several times. The unique index on `externalId` is what makes that
 * harmless — a duplicate is detected and dropped rather than appearing twice in
 * the agent's transcript.
 */
export const ingestMessengerMessage = async (inbound: InboundMessage) => {
  const duplicate = await prisma.supportMessage.findUnique({
    where: { externalId: inbound.externalId },
    select: { id: true },
  });
  if (duplicate) return null;

  const known = await prisma.supportContact.findUnique({
    where: {
      channel_externalId: { channel: SupportChannel.MESSENGER, externalId: inbound.senderId },
    },
    select: { id: true, name: true },
  });

  // Only pay for the profile lookup the first time we meet someone.
  const profile = known?.name ? {} : await fetchProfile(inbound.senderId);

  const contact = await upsertContact({
    channel: SupportChannel.MESSENGER,
    externalId: inbound.senderId,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    locale: profile.locale,
  });

  const existing = await openConversationFor(contact.id, SupportChannel.MESSENGER);
  const isNew = !existing;

  const conversation =
    existing ??
    (await createConversation({
      channel: SupportChannel.MESSENGER,
      contactId: contact.id,
      externalId: inbound.senderId,
    }));

  const message = await appendInbound({
    conversationId: conversation.id,
    author: SupportMessageAuthor.CUSTOMER,
    body: inbound.text,
    attachments: inbound.attachments.length
      ? (inbound.attachments as unknown as Prisma.InputJsonValue)
      : undefined,
    externalId: inbound.externalId,
    createdAt: inbound.sentAt,
  });

  broadcastMessage({ id: conversation.id, chatSessionId: null }, shapeMessage(message));
  await broadcastConversation(conversation.id, isNew ? "conversation.created" : "conversation.updated");

  return { conversationId: conversation.id, messageId: message.id };
};

// ---------------------------------------------------------------------------
// Windee
// ---------------------------------------------------------------------------

/** What of the bot transcript is worth replaying for the agent. */
const REPLAYABLE: ChatRole[] = [ChatRole.USER, ChatRole.ASSISTANT];

/**
 * Promotes a Windee chat to a support ticket.
 *
 * Called when a visitor asks for a person. The bot transcript is copied across
 * so the agent opens the thread already knowing what was asked and what Windee
 * answered — being made to repeat yourself to a second responder is the whole
 * reason handoffs feel bad.
 *
 * Idempotent: a session that already has a ticket returns the one it has, so a
 * double tap on "Talk to a human" cannot create two.
 */
export const handoffWindeeSession = async (chatSessionId: string) => {
  const existing = await prisma.supportConversation.findUnique({
    where: { chatSessionId },
  });
  if (existing) return existing;

  const session = await prisma.chatSession.findUnique({
    where: { id: chatSessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return null;

  const contact = await upsertContact({
    channel: SupportChannel.WINDEE,
    externalId: session.visitorId,
    name: session.name,
    phone: session.phone,
    userId: session.userId,
  });

  const conversation = await createConversation({
    channel: SupportChannel.WINDEE,
    contactId: contact.id,
    chatSessionId: session.id,
  });

  // Replay in order. These are history, not new work, so they do not raise the
  // unread count — the badge should mean "something arrived since you looked".
  const replay = session.messages.filter((m) => REPLAYABLE.includes(m.role) && m.content.trim());

  for (const line of replay) {
    await appendInbound({
      conversationId: conversation.id,
      author:
        line.role === ChatRole.USER ? SupportMessageAuthor.CUSTOMER : SupportMessageAuthor.BOT,
      body: line.content,
      attachments: line.imageUrl
        ? ([{ url: line.imageUrl, mime: "image/*", name: "attachment" }] as unknown as Prisma.InputJsonValue)
        : undefined,
      createdAt: line.createdAt,
      countsAsUnread: false,
    });
  }

  await prisma.supportConversation.update({
    where: { id: conversation.id },
    data: {
      // The customer is waiting on a person from this moment, whatever the
      // replayed history says.
      unreadForAgent: 1,
      lastMessageAt: new Date(),
      lastMessagePreview:
        replay.filter((m) => m.role === ChatRole.USER).at(-1)?.content.slice(0, 140) ??
        "Asked to speak to a person",
    },
  });

  await recordEvent(conversation.id, SupportEventType.QUEUED, null, { source: "windee-handoff" });
  await broadcastConversation(conversation.id, "conversation.created");

  return conversation;
};

/**
 * The customer pressing "End chat" in the widget.
 *
 * Closes the ticket from their side and leaves a line saying so, so an agent
 * mid-reply learns why the person stopped answering rather than being left
 * typing into a conversation nobody is reading. Returns them to Windee.
 */
export const endSupportForVisitor = async (chatSessionId: string) => {
  const conversation = await prisma.supportConversation.findUnique({
    where: { chatSessionId },
    select: { id: true, status: true, chatSessionId: true },
  });

  if (!conversation || conversation.status === SupportConversationStatus.CLOSED) return null;

  await prisma.supportConversation.update({
    where: { id: conversation.id },
    data: {
      status: SupportConversationStatus.CLOSED,
      closedAt: new Date(),
      unreadForAgent: 0,
    },
  });

  const line = await prisma.supportMessage.create({
    data: {
      conversationId: conversation.id,
      author: SupportMessageAuthor.SYSTEM,
      body: "The customer ended the chat and went back to Windee.",
    },
    include: messageInclude,
  });

  await recordEvent(conversation.id, SupportEventType.CLOSED, null, { by: "customer" });
  broadcastMessage(conversation, shapeMessage(line));
  await broadcastConversation(conversation.id, "conversation.closed");

  return conversation;
};

/**
 * Mirrors a message the visitor typed in the widget while they are waiting for,
 * or talking to, an agent.
 *
 * Without this the widget and the inbox would drift apart the moment someone
 * added "…and my order number is 12345" after asking for a human.
 */
export const ingestWindeeCustomerMessage = async (
  chatSessionId: string,
  body: string,
  imageUrl?: string | null,
) => {
  const conversation = await prisma.supportConversation.findUnique({
    where: { chatSessionId },
    select: { id: true, status: true, chatSessionId: true },
  });

  if (!conversation || conversation.status === SupportConversationStatus.CLOSED) return null;

  const message = await appendInbound({
    conversationId: conversation.id,
    author: SupportMessageAuthor.CUSTOMER,
    body,
    attachments: imageUrl
      ? ([{ url: imageUrl, mime: "image/*", name: "attachment" }] as unknown as Prisma.InputJsonValue)
      : undefined,
  });

  broadcastMessage(conversation, shapeMessage(message));
  await broadcastConversation(conversation.id);

  return message;
};
