import { Router } from "express";
import multer from "multer";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { multerConfig } from "../../utils/fileUploader";
import { SupportController } from "./support.controller";

const router = Router();

/**
 * Meta's webhook, mounted before the guards.
 *
 * It is called by Facebook, not by a signed-in agent, and authenticates itself
 * with an HMAC over the raw body (see `support.messenger.ts`). It is also
 * exempted from the global rate limiter in `app.ts`, because every delivery
 * arrives from the same few Facebook IPs.
 */
router.get("/webhooks/messenger", SupportController.verifyWebhook);
router.post("/webhooks/messenger", SupportController.receiveWebhook);

/**
 * Everything else is staff-only.
 *
 * ADMIN is included alongside CUSTOMER_SUPPORT so the inbox can be run and
 * tested before any agent account exists; the service creates the agent record
 * on first use either way.
 */
const canUse = auth(UserRole.ADMIN, UserRole.CUSTOMER_SUPPORT);
const adminOnly = auth(UserRole.ADMIN);

// Live updates. EventSource cannot set an Authorization header, so this relies
// on the accessToken cookie — which `auth` already accepts as a fallback.
router.get("/stream", canUse, SupportController.stream);
router.get("/health", canUse, SupportController.health);

// The signed-in agent
router.get("/me", canUse, SupportController.me);
router.patch("/me/presence", canUse, SupportController.setPresence);
router.post("/me/heartbeat", canUse, SupportController.heartbeat);
router.get("/agents", canUse, SupportController.agents);

// Dashboard furniture
router.get("/stats", canUse, SupportController.stats);
router.get("/channels", canUse, SupportController.channels);
router.get("/queues", canUse, SupportController.queues);
router.post("/queues", adminOnly, SupportController.createQueue);
router.delete("/queues/:id", adminOnly, SupportController.deleteQueue);
router.get("/tags", canUse, SupportController.listTags);
router.post("/upload", canUse, multer(multerConfig).single("file"), SupportController.upload);

// Conversations
router.get("/conversations", canUse, SupportController.listConversations);
router.get("/conversations/:id", canUse, SupportController.getConversation);
router.post("/conversations/:id/read", canUse, SupportController.markRead);
router.post("/conversations/:id/claim", canUse, SupportController.claim);
router.post("/conversations/:id/transfer", canUse, SupportController.transfer);
router.post("/conversations/:id/close", canUse, SupportController.close);
router.post("/conversations/:id/reopen", canUse, SupportController.reopen);
router.patch("/conversations/:id/priority", canUse, SupportController.setPriority);
router.post("/conversations/:id/messages", canUse, SupportController.reply);
router.post("/conversations/:id/typing", canUse, SupportController.typing);
router.post("/conversations/:id/tags", canUse, SupportController.addTag);
router.delete("/conversations/:id/tags/:tagId", canUse, SupportController.removeTag);

export const SupportRoutes = router;
