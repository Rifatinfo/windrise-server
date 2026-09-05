import express from "express";
import { GoogleOAuthController } from "./googleOAuth.controller";

const router = express.Router();

router.get("/google", GoogleOAuthController.googleAuth);
router.get("/google/callback", GoogleOAuthController.googleCallback);

export const GoogleOAuthRoutes = router;
