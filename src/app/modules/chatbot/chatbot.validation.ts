import { z } from "zod";

/**
 * The visitor id is minted by the widget and kept in localStorage. It is not a
 * credential in the security sense — it only scopes a guest to their own chat —
 * so it is bounded in length and shape to keep it out of the way of anything
 * that reads it back.
 */
const visitorId = z
  .string()
  .trim()
  .min(8, "Missing visitor id")
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Malformed visitor id");

const startSchema = z.object({
  visitorId,
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().min(6).max(24).optional(),
});

const messageSchema = z.object({
  visitorId,
  sessionId: z.string().trim().min(1),
  // A message may be an image with no words, so text alone is not required —
  // but something has to be sent.
  text: z.string().trim().max(2000).default(""),
  imageUrl: z
    .string()
    .trim()
    .regex(/^\/uploads\/chat\/[A-Za-z0-9._-]+$/, "Unexpected image path")
    .nullable()
    .optional(),
});

const sessionSchema = z.object({
  visitorId,
  sessionId: z.string().trim().min(1),
});

export const ChatbotValidation = {
  startSchema,
  messageSchema,
  sessionSchema,
};
