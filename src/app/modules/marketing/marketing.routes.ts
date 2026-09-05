import { Router } from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { MarketingController } from "./marketing.controller";

const router = Router();

router.use(auth(UserRole.ADMIN, UserRole.SHOP_MANAGER));

router.get("/traffic", MarketingController.getTrafficOverview);
router.get("/traffic-sources", MarketingController.getTrafficSources);
router.get("/meta-ads", MarketingController.getMetaAds);
router.get("/google-ads", MarketingController.getGoogleAds);
router.get("/performance", MarketingController.getPerformance);

export const MarketingRoutes = router;
