import { NextFunction, Request, Response, Router } from "express";
import { UserRole } from "@prisma/client";
import multer from "multer";

import auth from "../../middlewares/auth";
import { multerConfig } from "../../utils/fileUploader";
import { AdsController } from "./ads.controller";
import { AdsValidation } from "./ads.validation";

const router = Router();

const validate =
  (schema: (typeof AdsValidation)[keyof typeof AdsValidation]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

const canManage = auth(UserRole.ADMIN, UserRole.MEDIA_MANAGER);
const canRead = auth(UserRole.ADMIN, UserRole.MEDIA_MANAGER, UserRole.SHOP_MANAGER);

// Storefront, no auth. Declared first so the literal segments below are not
// swallowed by the "/:id" routes.
router.get("/active", AdsController.listActiveAds);
router.post("/:id/impression", AdsController.recordImpression);
router.post("/:id/click", AdsController.recordClick);

// Placements
router.get("/placements", canRead, AdsController.listPlacements);
router.post(
  "/placements",
  canManage,
  validate(AdsValidation.createPlacementSchema),
  AdsController.createPlacement,
);
router.patch(
  "/placements/:id",
  canManage,
  validate(AdsValidation.updatePlacementSchema),
  AdsController.updatePlacement,
);
router.delete("/placements/:id", canManage, AdsController.deletePlacement);

// Dashboard
router.get("/stats", canRead, AdsController.getAdStats);
router.post("/upload", canManage, multer(multerConfig).single("file"), AdsController.uploadCreative);
router.patch(
  "/bulk/status",
  canManage,
  validate(AdsValidation.bulkStatusSchema),
  AdsController.bulkUpdateStatus,
);
router.post(
  "/bulk/delete",
  canManage,
  validate(AdsValidation.bulkIdsSchema),
  AdsController.bulkDelete,
);

router.get("/", canRead, AdsController.listAds);
router.post("/", canManage, validate(AdsValidation.createAdSchema), AdsController.createAd);
router.get("/:id", canRead, AdsController.getAdById);
router.patch("/:id", canManage, validate(AdsValidation.updateAdSchema), AdsController.updateAd);
router.delete("/:id", canManage, AdsController.deleteAd);

export const AdsRoutes = router;
