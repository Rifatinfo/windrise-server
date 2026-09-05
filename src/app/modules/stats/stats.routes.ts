import { Router } from "express";
import { UserRole } from "@prisma/client";

import auth from "../../middlewares/auth";
import { StatsController } from "./stats.controller";

const router = Router();

router.use(auth(UserRole.ADMIN, UserRole.SHOP_MANAGER));

router.get("/summary", StatsController.getSummary);
router.get("/revenue-chart", StatsController.getRevenueChart);
router.get("/category-revenue-series", StatsController.getCategoryRevenueSeries);
router.get("/order-status", StatsController.getOrderStatusOverview);
router.get("/recent-orders", StatsController.getRecentOrders);
router.get("/top-products", StatsController.getTopProducts);
router.get("/sales-by-category", StatsController.getSalesByCategory);
router.get("/sales-by-subcategory", StatsController.getSalesBySubcategory);
router.get("/sales-by-payment-method", StatsController.getSalesByPaymentMethod);
router.get("/sales-by-location", StatsController.getSalesByLocation);
router.get("/customers-overview", StatsController.getCustomersOverview);
router.get("/new-vs-returning", StatsController.getNewVsReturning);
router.get("/returns-overview", StatsController.getReturnsOverview);
router.get("/return-reasons", StatsController.getReturnReasons);
router.get("/inventory-summary", StatsController.getInventorySummary);
router.get("/coupons-performance", StatsController.getCouponsPerformance);
router.get("/discounts-performance", StatsController.getDiscountsPerformance);
router.get("/sales-funnel", StatsController.getSalesFunnel);
router.get("/product-performance", StatsController.getProductPerformance);
router.get("/sales-target", StatsController.getSalesTarget);
router.patch("/sales-target", StatsController.updateSalesTarget);
router.get("/daily-snapshot", StatsController.getDailySnapshot);
router.get("/best-customers", StatsController.getBestCustomers);
router.get("/customer-lifetime-value", StatsController.getCustomerLifetimeValue);
router.get("/alerts", StatsController.getAlerts);
router.get("/business-performance", StatsController.getBusinessPerformance);
router.get("/export", StatsController.exportStatsReport);

export const StatsRoutes = router;
