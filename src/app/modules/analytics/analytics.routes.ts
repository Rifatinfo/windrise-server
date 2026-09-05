import { Request, Response, NextFunction, Router } from "express";

import { AnalyticsController } from "./analytics.controller";
import { AnalyticsValidation } from "./analytics.validation";

const router = Router();

router.post(
  "/event",
  (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = AnalyticsValidation.trackEventSchema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  },
  AnalyticsController.trackEvent,
);

export const AnalyticsRoutes = router;
