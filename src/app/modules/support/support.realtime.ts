/**
 * Live updates for the support inbox.
 *
 * An agent's inbox has to move on its own: a message arriving on a Messenger
 * thread they are reading, a colleague claiming the ticket they were about to
 * take, the queue counter ticking down. Polling five panels on a timer would be
 * both slow and noisy, so the server pushes.
 *
 * Transport is server-sent events rather than websockets. The dashboard only
 * ever needs one direction — everything the agent does is already a normal
 * authenticated POST — and SSE is plain HTTP, so it inherits the existing CORS,
 * cookie and proxy setup with nothing new to configure and reconnects on its
 * own if the connection drops.
 *
 * Scope note: the fan-out is in-process. That is correct for a single API
 * instance, which is what runs today. Behind more than one instance the emit
 * would need a shared bus (Redis pub/sub) so an event raised on instance A
 * reaches the agents connected to instance B — the publish/subscribe seam here
 * is deliberately the only place that would have to change.
 */

import { EventEmitter } from "events";
import type { Response } from "express";

export type SupportEventName =
  | "conversation.created"
  | "conversation.updated"
  | "conversation.closed"
  | "message.created"
  | "agent.presence"
  | "typing";

export type SupportRealtimeEvent = {
  name: SupportEventName;
  /** Everything the client needs to patch its cache without a refetch. */
  payload: Record<string, unknown>;
  /**
   * Set when the event concerns one conversation. Widget streams are filtered
   * on it so a visitor only ever receives their own thread.
   */
  conversationId?: string;
  /** Set for WINDEE conversations, so the storefront widget can subscribe. */
  chatSessionId?: string;
};

const bus = new EventEmitter();
// One listener per open dashboard tab and per open widget; the default cap of
// 10 would start printing leak warnings with a handful of agents online.
bus.setMaxListeners(0);

const CHANNEL = "support";

export const publish = (event: SupportRealtimeEvent) => {
  bus.emit(CHANNEL, event);
};

/** Heartbeat interval. Comfortably under the 60s idle timeout of most proxies. */
const HEARTBEAT_MS = 25_000;

type StreamOptions = {
  /**
   * Return true to forward the event to this client. Agents take everything;
   * a visitor's widget takes only its own conversation.
   */
  accept: (event: SupportRealtimeEvent) => boolean;
};

/**
 * Turns a response into an SSE stream and keeps it open until the client goes
 * away. Returns nothing — the request is now owned by this function.
 */
export const openStream = (res: Response, { accept }: StreamOptions) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx buffers proxied responses by default, which would hold every event
    // until the buffer filled and make the stream look broken.
    "X-Accel-Buffering": "no",
  });

  // Flush the headers immediately so the browser's EventSource fires `open`
  // rather than waiting for the first event.
  res.write(`event: ready\ndata: {}\n\n`);

  const onEvent = (event: SupportRealtimeEvent) => {
    if (!accept(event)) return;
    res.write(`event: ${event.name}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  bus.on(CHANNEL, onEvent);

  const heartbeat = setInterval(() => {
    // A comment frame: valid SSE, ignored by EventSource, enough to keep every
    // hop in the chain from deciding the connection is idle.
    res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off(CHANNEL, onEvent);
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
};

/** How many dashboards/widgets are currently attached. Surfaced by the health route. */
export const streamCount = () => bus.listenerCount(CHANNEL);
