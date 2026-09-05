/**
 * Facebook Messenger adapter.
 *
 * Everything that knows about Meta lives here: signature checking, the shape of
 * a webhook delivery, and the Graph calls that send a reply back. The inbox
 * service above it works in normalised terms — a contact, a conversation, a
 * message — so adding WhatsApp or Instagram later means writing a sibling of
 * this file rather than touching the inbox.
 */

import crypto from "crypto";
import axios from "axios";
import { StatusCodes } from "http-status-codes";

import { envVars } from "../../../config";
import ApiError from "../../errors/ApiError";

const graphBase = () =>
  `https://graph.facebook.com/${envVars.META_GRAPH_API_VERSION ?? "v21.0"}`;

/**
 * Whether replies can actually be sent. The dashboard shows the channel either
 * way — an agent should still be able to read a thread that arrived before a
 * token expired — but the send path refuses rather than dropping the message.
 */
export const isMessengerConfigured = () =>
  Boolean(envVars.META_PAGE_ID && envVars.META_PAGE_ACCESS_TOKEN);

/**
 * Confirms a delivery really came from Meta.
 *
 * The webhook URL is public, so without this anyone could POST a message that
 * appears in the inbox as a customer. Compared in constant time over the exact
 * bytes received — re-serialising the parsed JSON would change the digest.
 */
export const verifySignature = (rawBody: Buffer | undefined, header: string | undefined) => {
  if (!envVars.META_APP_SECRET) return false;
  if (!rawBody || !header?.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", envVars.META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  const received = header.slice("sha256=".length);

  // timingSafeEqual throws on a length mismatch, which would itself leak a bit
  // of information — check the length first.
  if (received.length !== expected.length) return false;

  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
};

/**
 * The GET half of the webhook handshake. Meta calls this once when the
 * subscription is created and expects the challenge echoed verbatim.
 */
export const verifyChallenge = (query: Record<string, unknown>) => {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof token === "string" &&
    envVars.META_WEBHOOK_VERIFY_TOKEN &&
    token === envVars.META_WEBHOOK_VERIFY_TOKEN
  ) {
    return String(challenge ?? "");
  }

  return null;
};

export type InboundAttachment = {
  url: string;
  mime: string;
  name: string;
};

/** One customer message, flattened out of Meta's nested delivery envelope. */
export type InboundMessage = {
  /** The sender's Page-Scoped ID — also the address a reply goes to. */
  senderId: string;
  pageId: string;
  /** Meta's message id. Used to drop redeliveries. */
  externalId: string;
  text: string;
  attachments: InboundAttachment[];
  sentAt: Date;
};

type WebhookEntry = {
  id?: string;
  messaging?: Array<{
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number;
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      attachments?: Array<{ type?: string; payload?: { url?: string } }>;
    };
  }>;
};

/**
 * Flattens a webhook body into the messages worth storing.
 *
 * Deliveries carry read receipts, delivery confirmations and echoes of our own
 * outbound messages alongside real customer text. Only the last of those
 * belongs in the transcript — an echo in particular would duplicate every agent
 * reply, since we already record it when we send it.
 */
export const parseInbound = (body: unknown): InboundMessage[] => {
  const entries = (body as { entry?: WebhookEntry[] } | null)?.entry;
  if (!Array.isArray(entries)) return [];

  const out: InboundMessage[] = [];

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      const senderId = event.sender?.id;

      if (!message || !senderId || message.is_echo) continue;
      if (!message.mid) continue;

      const attachments: InboundAttachment[] = (message.attachments ?? [])
        .filter((a) => a.payload?.url)
        .map((a) => ({
          url: a.payload!.url as string,
          mime: a.type === "image" ? "image/*" : (a.type ?? "application/octet-stream"),
          name: a.type ?? "attachment",
        }));

      // A sticker or a bare attachment has no text at all; skip only when there
      // is nothing to show either way.
      if (!message.text && attachments.length === 0) continue;

      out.push({
        senderId,
        pageId: entry.id ?? event.recipient?.id ?? "",
        externalId: message.mid,
        text: message.text ?? "",
        attachments,
        sentAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      });
    }
  }

  return out;
};

export type MessengerProfile = {
  name?: string;
  avatarUrl?: string;
  locale?: string;
};

/**
 * Looks up the sender's public profile so the inbox shows a name and a photo
 * rather than a numeric id.
 *
 * Best-effort by design: profile access depends on Page permissions that a
 * development app often lacks, and a conversation is still perfectly usable
 * under "Messenger user". Never throws.
 */
export const fetchProfile = async (psid: string): Promise<MessengerProfile> => {
  if (!envVars.META_PAGE_ACCESS_TOKEN) return {};

  try {
    const { data } = await axios.get(`${graphBase()}/${psid}`, {
      params: {
        fields: "name,first_name,last_name,profile_pic,locale",
        access_token: envVars.META_PAGE_ACCESS_TOKEN,
      },
      timeout: 8000,
    });

    const name =
      data?.name ??
      [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim() ??
      undefined;

    return {
      name: name || undefined,
      avatarUrl: data?.profile_pic || undefined,
      locale: data?.locale || undefined,
    };
  } catch {
    return {};
  }
};

/**
 * Sends an agent's reply to the customer.
 *
 * Throws on failure rather than swallowing it: a reply the customer never
 * received must not sit in the transcript looking delivered, so the caller
 * records the error against the message and the agent sees it.
 */
export const sendText = async (psid: string, text: string): Promise<string | null> => {
  if (!isMessengerConfigured()) {
    throw new ApiError(
      StatusCodes.SERVICE_UNAVAILABLE,
      "Messenger is not connected. Add the Page credentials to send replies.",
    );
  }

  try {
    const { data } = await axios.post(
      `${graphBase()}/${envVars.META_PAGE_ID}/messages`,
      {
        recipient: { id: psid },
        // RESPONSE is the correct type for answering a customer inside the
        // 24-hour window; anything outside it needs a message tag and would be
        // rejected, which surfaces below as a readable error.
        messaging_type: "RESPONSE",
        message: { text },
      },
      {
        params: { access_token: envVars.META_PAGE_ACCESS_TOKEN },
        timeout: 12_000,
      },
    );

    return (data?.message_id as string) ?? null;
  } catch (error) {
    const detail =
      axios.isAxiosError(error) && error.response?.data?.error?.message
        ? (error.response.data.error.message as string)
        : "Messenger rejected the message.";

    throw new ApiError(StatusCodes.BAD_GATEWAY, detail);
  }
};

/**
 * Turns the "typing" bubble on the customer's side, and marks their message
 * read. Cosmetic, so failures are swallowed — a reply must never be blocked by
 * an indicator that would not draw.
 */
export const sendSenderAction = async (
  psid: string,
  action: "mark_seen" | "typing_on" | "typing_off",
) => {
  if (!isMessengerConfigured()) return;

  try {
    await axios.post(
      `${graphBase()}/${envVars.META_PAGE_ID}/messages`,
      { recipient: { id: psid }, sender_action: action },
      { params: { access_token: envVars.META_PAGE_ACCESS_TOKEN }, timeout: 6000 },
    );
  } catch {
    /* indicator only */
  }
};
