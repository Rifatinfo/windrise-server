import { NextFunction, Request, Response, Router } from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { PricingController } from "./pricing.controller";
import { PricingValidation } from "./pricing.validation";

const router = Router();

const validate =
  (schema: (typeof PricingValidation)[keyof typeof PricingValidation]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

const canUse = auth(UserRole.ADMIN, UserRole.SHOP_MANAGER);

router.post("/compute", canUse, validate(PricingValidation.reportSchema), PricingController.compute);
router.post("/report", canUse, validate(PricingValidation.reportSchema), PricingController.downloadReport);

router.get("/templates", canUse, PricingController.listTemplates);
router.post(
  "/templates",
  canUse,
  validate(PricingValidation.templateSchema),
  PricingController.createTemplate,
);
router.get("/templates/:id", canUse, PricingController.getTemplate);
router.patch(
  "/templates/:id",
  canUse,
  validate(PricingValidation.templateSchema),
  PricingController.updateTemplate,
);
router.delete("/templates/:id", canUse, PricingController.deleteTemplate);

export const PricingRoutes = router;
