import express from "express";
import { PaymentController } from "./payment.controller";

const router = express.Router();

//============== Initiate payment for a specific order ================//
router.post("/init-payment/:orderId", PaymentController.initPayment);
router.post("/success", PaymentController.successPayment);
router.post("/fail", PaymentController.failPayment);
// SSLCommerz posts this callback; some flows redirect the browser here as a
// GET instead, so both are accepted.
router.post("/cancel", PaymentController.cancelPayment);
router.get("/cancel", PaymentController.cancelPayment);
router.post("/validate-payment", PaymentController.validatePayment);

export const PaymentRoutes = router;