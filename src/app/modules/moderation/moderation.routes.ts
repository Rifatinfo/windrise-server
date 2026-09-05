import { Router } from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { ModerationController } from "./moderation.controller";

const router = Router();

// Reading and removing what customers have written is an owner's job, so this
// is admin-only — narrower than the rest of the dashboard on purpose.
const adminOnly = auth(UserRole.ADMIN);

router.get("/comments", adminOnly, ModerationController.listComments);
router.delete("/comments/:source/:id", adminOnly, ModerationController.deleteComment);

export const ModerationRoutes = router;
