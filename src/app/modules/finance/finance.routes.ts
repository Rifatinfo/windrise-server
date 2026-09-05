import { NextFunction, Request, Response, Router } from "express";
import { UserRole } from "@prisma/client";
import { ZodType } from "zod";

import auth from "../../middlewares/auth";
import { FinanceController } from "./finance.controller";
import { FinanceValidation } from "./finance.validation";

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

// Finance figures are admin-only; the sidebar entry is gated the same way.
const canUse = auth(UserRole.ADMIN);

router.get("/overview", canUse, FinanceController.getOverview);
router.put("/revenue", canUse, validate(FinanceValidation.revenueSchema), FinanceController.setRevenue);

router.get("/categories", canUse, FinanceController.listCategories);
router.post(
  "/categories",
  canUse,
  validate(FinanceValidation.createCategorySchema),
  FinanceController.createCategory,
);
router.patch(
  "/categories/:id",
  canUse,
  validate(FinanceValidation.updateCategorySchema),
  FinanceController.updateCategory,
);
router.delete("/categories/:id", canUse, FinanceController.deleteCategory);

router.get("/products", canUse, FinanceController.listProductOptions);

router.get("/investments", canUse, FinanceController.listInvestments);
router.post(
  "/investments",
  canUse,
  validate(FinanceValidation.investmentSchema),
  FinanceController.createInvestment,
);
router.patch(
  "/investments/:id",
  canUse,
  validate(FinanceValidation.updateInvestmentSchema),
  FinanceController.updateInvestment,
);
router.delete("/investments/:id", canUse, FinanceController.deleteInvestment);

export const FinanceRoutes = router;
