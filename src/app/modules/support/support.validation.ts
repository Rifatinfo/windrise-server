import { z } from "zod";
import {
  SupportAgentPresence,
  SupportChannel,
  SupportConversationStatus,
  SupportPriority,
} from "@prisma/client";

const presenceSchema = z.object({
  presence: z.nativeEnum(SupportAgentPresence),
});

const attachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  size: z.number().int().nonnegative().optional(),
});

const replySchema = z
  .object({
    body: z.string().max(8000).default(""),
    attachments: z.array(attachmentSchema).max(10).optional(),
    isInternalNote: z.boolean().optional(),
  })
  .refine((value) => value.body.trim().length > 0 || (value.attachments?.length ?? 0) > 0, {
    message: "Write something before sending.",
    path: ["body"],
  });

/**
 * A transfer must name a destination. Without this an empty body would quietly
 * unassign the conversation and drop it back in the queue — a plausible action,
 * but never the one the agent meant by pressing Transfer.
 */
const transferSchema = z
  .object({
    agentId: z.string().min(1).nullable().optional(),
    queueId: z.string().min(1).nullable().optional(),
    note: z.string().max(500).optional(),
  })
  .refine((value) => Boolean(value.agentId || value.queueId), {
    message: "Choose an agent or a queue to transfer to.",
  });

const prioritySchema = z.object({ priority: z.nativeEnum(SupportPriority) });

const closeSchema = z.object({ reason: z.string().max(300).optional() });

const tagSchema = z.object({ name: z.string().min(1).max(40) });

const typingSchema = z.object({ on: z.boolean() });

const queueSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
});

/** Query parameters arrive as strings, so numbers and enums are coerced here. */
const listQuerySchema = z.object({
  channel: z.nativeEnum(SupportChannel).optional(),
  queueId: z.string().min(1).optional(),
  status: z.nativeEnum(SupportConversationStatus).optional(),
  scope: z.enum(["all", "mine", "unassigned"]).optional(),
  // Arrives as the string "true"/"false" on the query string.
  unread: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const SupportValidation = {
  presenceSchema,
  replySchema,
  transferSchema,
  prioritySchema,
  closeSchema,
  tagSchema,
  typingSchema,
  queueSchema,
  listQuerySchema,
};
