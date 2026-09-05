import express from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { SettingsController } from "./settings.controller";
import { updateStoreSettingsSchema } from "./settings.validation";

const router = express.Router();

// Storefront needs shipping rates and contact details before sign-in.
router.get("/public", SettingsController.getPublicSettings);

// Dashboard roles may read the full settings...
router.get(
  "/",
  auth(UserRole.ADMIN, UserRole.SHOP_MANAGER, UserRole.MEDIA_MANAGER),
  SettingsController.getSettings
);

// ...but only an admin may change them.
router.patch(
  "/",
  auth(UserRole.ADMIN),
  (req, _res, next) => {
    try {
      req.body = updateStoreSettingsSchema.parse(req.body ?? {});
      next();
    } catch (error) {
      next(error);
    }
  },
  SettingsController.updateSettings
);

export const SettingsRoutes = router;
