import { Request, Response, NextFunction, Router } from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { CouponController } from "./coupon.controller";
import { CouponValidation } from "./coupon.validation";

const router = Router();

const validate =
  (schema: (typeof CouponValidation)[keyof typeof CouponValidation]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

router.post(
  "/validate",
  validate(CouponValidation.validateCouponSchema),
  CouponController.validateCoupon,
);

router.post(
  "/",
  auth(UserRole.ADMIN, UserRole.SHOP_MANAGER),
  validate(CouponValidation.createCouponSchema),
  CouponController.createCoupon,
);
router.get("/", auth(UserRole.ADMIN, UserRole.SHOP_MANAGER), CouponController.getAllCoupons);
router.patch(
  "/:id",
  auth(UserRole.ADMIN, UserRole.SHOP_MANAGER),
  validate(CouponValidation.updateCouponSchema),
  CouponController.updateCoupon,
);
router.patch(
  "/:id/deactivate",
  auth(UserRole.ADMIN, UserRole.SHOP_MANAGER),
  CouponController.deactivateCoupon,
);

export const CouponRoutes = router;
