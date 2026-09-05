import { Router } from "express";
import multer from "multer";

import { multerConfig } from "../../utils/fileUploader";
import { reviewRateLimiter } from "../../middlewares/rateLimiter";
import { ReviewController } from "./review.controller";

const router = Router();

/**
 * Public by design: reviews come from guests, and the gate is the order book,
 * not a login. Rate limited because these routes are open and each write
 * touches the database.
 */
router.get("/product/:productId", ReviewController.listReviews);
router.post("/eligibility", reviewRateLimiter, ReviewController.checkEligibility);
router.post("/", reviewRateLimiter, ReviewController.submitReview);
router.post(
  "/upload",
  reviewRateLimiter,
  multer(multerConfig).single("file"),
  ReviewController.uploadImage,
);

export const ReviewRoutes = router;
