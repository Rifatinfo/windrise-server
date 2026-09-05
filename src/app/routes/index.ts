
import express from "express";
import { authRateLimiter } from "../middlewares/rateLimiter";
import { AuthRoutes } from "../modules/auth/auth.route";
import { UserRoutes } from "../modules/user/user.route";
import { ProductRoutes } from "../modules/product/product.routes";
import { OrderRoutes } from "../modules/order/order.routes";
import { PaymentRoutes } from "../modules/payment/payment.routes";
import { InventoryRoutes } from "../modules/inventory/inventory.routes";
import { StatsRoutes } from "../modules/stats/stats.routes";
import { CouponRoutes } from "../modules/coupon/coupon.routes";
import { ReturnRoutes } from "../modules/returns/returns.routes";
import { MarketingRoutes } from "../modules/marketing/marketing.routes";
import { AnalyticsRoutes } from "../modules/analytics/analytics.routes";
import { SettingsRoutes } from "../modules/settings/settings.routes";
import { BlogRoutes } from "../modules/blog/blog.routes";
import { AdsRoutes } from "../modules/ads/ads.routes";
import { PricingRoutes } from "../modules/pricing/pricing.routes";
import { FinanceRoutes } from "../modules/finance/finance.routes";
import { ChatbotRoutes } from "../modules/chatbot/chatbot.routes";
import { SupportRoutes } from "../modules/support/support.routes";
import { ReviewRoutes } from "../modules/review/review.routes";
import { ModerationRoutes } from "../modules/moderation/moderation.routes";


const router = express.Router();

const moduleRoutes = [
  {
    path: "/user",
    route: UserRoutes,
  },
  {
    path: "/settings",
    route: SettingsRoutes,
  },
  {
    path: "/blog",
    route: BlogRoutes,
  },
  {
    path: "/ads",
    route: AdsRoutes,
  },
  {
    path: "/pricing",
    route: PricingRoutes,
  },
  {
    path: "/finance",
    route: FinanceRoutes,
  },
  {
    path: "/ai-conversation-chatbot",
    route: ChatbotRoutes,
  },
  {
    path: "/support",
    route: SupportRoutes,
  },
  {
    path: "/product-review",
    route: ReviewRoutes,
  },
  {
    path: "/moderation",
    route: ModerationRoutes,
  },
  {
    path: "/auth",
    route: AuthRoutes,
    // middlewares: [authRateLimiter], // Apply only here
  },
  {
    path: "/product",
    route: ProductRoutes,
  },
  {
    path: "/order",
    route: OrderRoutes,
  },
  {
    path: "/payment",
    route: PaymentRoutes,
  },
  {
    path: "/inventory",
    route: InventoryRoutes,
  },
  {
    path: "/stats",
    route: StatsRoutes,
  },
  {
    path: "/coupon",
    route: CouponRoutes,
  },
  {
    path: "/return",
    route: ReturnRoutes,
  },
  {
    path: "/marketing",
    route: MarketingRoutes,
  },
  {
    path: "/analytics",
    route: AnalyticsRoutes,
  },
];

moduleRoutes.forEach((route) => {
  router.use(
    route.path,
    // ...(route.middlewares || []),
    route.route
  );
});

export default router;