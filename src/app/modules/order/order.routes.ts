
import { Router } from "express";
import {  OrderController } from "./order.controller";
import auth from "../../middlewares/auth";
import optionalAuth from "../../middlewares/optionalAuth";
import validateRequest from "../../middlewares/validateRequest";
import { orderTrackRateLimiter } from "../../middlewares/rateLimiter";
import { OrderValidation } from "./order.validation";
import { UserRole } from "@prisma/client";


const router = Router();

router.post("/", optionalAuth, OrderController.createOrderController);
// Public: guests track an order with its order number + the phone on the order.
router.post(
  "/track",
  orderTrackRateLimiter,
  validateRequest(OrderValidation.trackOrderSchema),
  OrderController.trackOrderController,
);
router.get("/", auth(UserRole.ADMIN), OrderController.getAllOrdersController);
router.get("/my-orders", auth(UserRole.CUSTOMER, UserRole.ADMIN), OrderController.getMyOrdersController);
router.get("/tracking/:orderId", auth(UserRole.CUSTOMER, UserRole.ADMIN), OrderController.getOrderTrackingController);
router.patch("/:orderId/status", auth(UserRole.ADMIN), OrderController.updateOrderStatusController);
router.patch("/:orderId/shipment-status", auth(UserRole.ADMIN), OrderController.updateOrderShipmentStatusController);
router.patch("/:orderId/after-sales-status", auth(UserRole.ADMIN), OrderController.updateOrderAfterSalesStatusController);
router.patch("/:orderId/payment-status", auth(UserRole.ADMIN), OrderController.updateOrderPaymentStatusController);
router.patch("/:orderId", auth(UserRole.ADMIN), OrderController.updateOrderInfoController);
router.get("/transaction/:transactionId", OrderController.getOrderByTransactionIdController);
router.get("/:id",  OrderController.getOrderByIdController);
export const OrderRoutes = router;
