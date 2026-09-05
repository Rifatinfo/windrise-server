import { Request, Response, NextFunction, Router } from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { ReturnController } from "./returns.controller";
import { ReturnValidation } from "./returns.validation";

const router = Router();

const validate =
  (schema: (typeof ReturnValidation)[keyof typeof ReturnValidation]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

router.use(auth(UserRole.ADMIN, UserRole.SHOP_MANAGER));

router.post("/", validate(ReturnValidation.createReturnSchema), ReturnController.createReturn);
router.get("/", ReturnController.getAllReturns);
router.patch("/:id", validate(ReturnValidation.updateReturnSchema), ReturnController.updateReturn);

export const ReturnRoutes = router;
