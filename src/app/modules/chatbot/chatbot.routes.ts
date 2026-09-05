import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { Secret } from "jsonwebtoken";
import { ZodType } from "zod";

import { envVars } from "../../../config";
import { jwtHelper } from "../../helpers/jwtHelpers";
import { chatbotRateLimiter } from "../../middlewares/rateLimiter";
import { multerConfig } from "../../utils/fileUploader";
import { ChatbotController } from "./chatbot.controller";
import { ChatbotValidation } from "./chatbot.validation";

const router = Router();

const validate =
  (schema: ZodType) => (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

/**
 * Windee is available to signed-out visitors, so a missing or invalid token is
 * not an error here — it just means the chat stays anonymous. When a token is
 * present the user is attached, which lets an order placed in chat be filed
 * against their account.
 */
const optionalAuth = (
  req: Request & { user?: { id?: string; email?: string } },
  _res: Response,
  next: NextFunction,
) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.split(" ")[1]
    : req.cookies?.accessToken;

  if (token) {
    try {
      const claims = jwtHelper.verifyToken(token, envVars.JWT_SECRET as Secret);
      req.user = { id: claims.id as string, email: claims.email as string };
    } catch {
      // Expired or tampered token: carry on as a guest.
    }
  }

  next();
};

router.post(
  "/start",
  optionalAuth,
  validate(ChatbotValidation.startSchema),
  ChatbotController.start,
);

router.get("/session/:sessionId", ChatbotController.getSession);
router.get("/stream", ChatbotController.stream);

router.post(
  "/message",
  chatbotRateLimiter,
  optionalAuth,
  validate(ChatbotValidation.messageSchema),
  ChatbotController.sendMessage,
);

router.post(
  '/confirm',
  optionalAuth,
  validate(ChatbotValidation.sessionSchema),
  ChatbotController.confirmPending,
);

router.post(
  '/decline',
  validate(ChatbotValidation.sessionSchema),
  ChatbotController.declinePending,
);

router.post(
  '/human',
  validate(ChatbotValidation.sessionSchema),
  ChatbotController.requestHuman,
);

router.post(
  "/resume-ai",
  validate(ChatbotValidation.sessionSchema),
  ChatbotController.resumeAi,
);

router.post(
  "/close",
  validate(ChatbotValidation.sessionSchema),
  ChatbotController.closeSession,
);

router.post(
  "/upload",
  chatbotRateLimiter,
  multer(multerConfig).single("file"),
  ChatbotController.uploadImage,
);

export const ChatbotRoutes = router;
