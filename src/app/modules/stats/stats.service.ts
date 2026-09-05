import { OrderStatus } from "@prisma/client";

import prisma from "../../../shared/prisma";
import { InventoryService } from "../inventory/inventory.service";
import { VALID_ORDER_STATUS_FILTER } from "./stats.constant";
import { SettingsService } from "../settings/settings.service";

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

const pctChange = (curr: number, prev: number) => {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return round1(((curr - prev) / prev) * 100);
};

const getPreviousRange = (start: Date, end: Date) => {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { prevStart, prevEnd };
};

// ============================= §1 / §3 — Summary + Growth =============================

const computeSummaryForRange = async (start: Date, end: Date) => {
  const [orders, validAgg, itemsAgg, customerRows, sessions] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.orderItem.aggregate({
      where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
      _sum: { quantity: true },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { userId: true, checkoutEmail: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { type: "PAGE_VIEW", createdAt: { gte: start, lte: end } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
  ]);

  const customerSet = new Set(customerRows.map((o) => o.userId ?? o.checkoutEmail ?? "guest"));
  const revenue = validAgg._sum.totalAmount ?? 0;
  const validOrders = validAgg._count._all;
  const productsSold = itemsAgg._sum.quantity ?? 0;
  const uniqueSessions = sessions.length;

  return {
    revenue: round2(revenue),
    orders,
    customers: customerSet.size,
    aov: validOrders === 0 ? 0 : round2(revenue / validOrders),
    productsSold,
    conversionRate: uniqueSessions === 0 ? 0 : round1((validOrders / uniqueSessions) * 100),
  };
};

const getSummary = async (start: Date, end: Date) => {
  const { prevStart, prevEnd } = getPreviousRange(start, end);
  const [current, previous] = await Promise.all([
    computeSummaryForRange(start, end),
    computeSummaryForRange(prevStart, prevEnd),
  ]);

  const metrics = ["revenue", "orders", "customers", "aov", "productsSold", "conversionRate"] as const;
  const result = {} as Record<
    (typeof metrics)[number],
    { value: number; previous: number; change: number }
  >;

  for (const metric of metrics) {
    result[metric] = {
      value: current[metric],
      previous: previous[metric],
      change: pctChange(current[metric], previous[metric]),
    };
  }

  return result;
};

// ============================= §2 — Revenue & Sales chart =============================

const getRevenueChart = async (start: Date, end: Date, granularity: "day" | "week" | "month") => {
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER },
    select: { createdAt: true, totalAmount: true },
  });

  const bucketKey = (date: Date) => {
    if (granularity === "month") {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    if (granularity === "week") {
      const d = new Date(date);
      const day = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - day);
      return d.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  };

  const buckets = new Map<string, { revenue: number; orders: number }>();
  for (const order of orders) {
    const key = bucketKey(order.createdAt);
    const entry = buckets.get(key) ?? { revenue: 0, orders: 0 };
    entry.revenue += order.totalAmount;
    entry.orders += 1;
    buckets.set(key, entry);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, revenue: round2(v.revenue), orders: v.orders }));
};

/**
 * Revenue split by category, bucketed over time — the series a stacked area
 * chart needs to show how the category mix shifts across the range.
 *
 * Categories are capped to the top N by revenue; the rest roll into "Other"
 * so the stack stays readable.
 */
const getCategoryRevenueSeries = async (
  start: Date,
  end: Date,
  granularity: "day" | "week" | "month",
  topN = 5,
) => {
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
    select: {
      total: true,
      order: { select: { createdAt: true } },
      product: { select: { categories: { select: { category: { select: { name: true } } } } } },
    },
  });

  const bucketKey = (date: Date) => {
    if (granularity === "month") {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    if (granularity === "week") {
      const d = new Date(date);
      const day = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - day);
      return d.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  };

  // Rank categories first so we know which ones survive as their own series.
  const totals = new Map<string, number>();
  for (const item of items) {
    const names = item.product?.categories.map((c) => c.category.name) ?? [];
    for (const name of names.length ? names : ["Uncategorized"]) {
      totals.set(name, (totals.get(name) ?? 0) + item.total);
    }
  }

  const ranked = [...totals.entries()].sort(([, a], [, b]) => b - a).map(([name]) => name);
  const kept = ranked.slice(0, topN);
  const hasOther = ranked.length > topN;
  const categories = hasOther ? [...kept, "Other"] : kept;

  const buckets = new Map<string, Map<string, number>>();
  for (const item of items) {
    const key = bucketKey(item.order.createdAt);
    const row = buckets.get(key) ?? new Map<string, number>();
    const names = item.product?.categories.map((c) => c.category.name) ?? [];

    for (const name of names.length ? names : ["Uncategorized"]) {
      const series = kept.includes(name) ? name : "Other";
      row.set(series, (row.get(series) ?? 0) + item.total);
    }
    buckets.set(key, row);
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => {
      const point: Record<string, string | number> = { date };
      for (const name of categories) point[name] = round2(row.get(name) ?? 0);
      return point;
    });

  return { categories, points };
};

// ============================= §4 — Order Status Overview =============================

const getOrderStatusOverview = async (start: Date, end: Date) => {
  const [groups, returned] = await Promise.all([
    prisma.order.groupBy({
      by: ["orderStatus"],
      where: { createdAt: { gte: start, lte: end } },
      _count: { _all: true },
    }),
    prisma.orderReturn.count({ where: { createdAt: { gte: start, lte: end } } }),
  ]);

  const countOf = (status: OrderStatus) => groups.find((g) => g.orderStatus === status)?._count._all ?? 0;
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);

  return {
    total,
    pending: countOf(OrderStatus.PLACED),
    confirmed: countOf(OrderStatus.CONFIRMED),
    processing: countOf(OrderStatus.PROCESSED),
    shipped: countOf(OrderStatus.ON_THE_WAY),
    delivered: countOf(OrderStatus.DELIVERED),
    cancelled: countOf(OrderStatus.CANCELED),
    failed: countOf(OrderStatus.FAILED),
    expired: countOf(OrderStatus.EXPIRED),
    returned,
  };
};

// ============================= §5 — Recent Orders =============================

const getRecentOrders = async (limit: number) => {
  const orders = await prisma.order.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: {
      items: { select: { productName: true } },
      payment: { select: { paymentMethod: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    customerName: o.name,
    product: o.items[0]?.productName ?? "—",
    additionalItems: Math.max(o.items.length - 1, 0),
    amount: o.totalAmount,
    paymentMethod: o.payment?.paymentMethod ?? o.paymentMethod,
    paymentStatus: o.paymentStatus,
    orderStatus: o.orderStatus,
    createdAt: o.createdAt,
  }));
};

// ============================= §6 — Top Selling Products =============================

const getTopProducts = async (start: Date, end: Date, limit: number) => {
  const grouped = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
    _sum: { quantity: true, total: true },
    orderBy: { _sum: { total: "desc" } },
    take: limit,
  });

  const productIds = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      thumbnailImage: true,
      images: { select: { url: true }, take: 1 },
      stockQuantity: true,
      stockStatus: true,
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return grouped.map((g) => {
    const product = productMap.get(g.productId);
    return {
      productId: g.productId,
      name: product?.name ?? "Deleted product",
      image: product?.thumbnailImage ?? product?.images[0]?.url ?? null,
      unitsSold: g._sum.quantity ?? 0,
      revenue: round2(g._sum.total ?? 0),
      currentStock: product?.stockQuantity ?? 0,
      status: product?.stockStatus ?? "OUT_OF_STOCK",
    };
  });
};

// ============================= §7 / §8 — Category / Subcategory breakdown =============================

const getCategoryBreakdown = async (start: Date, end: Date, relation: "categories" | "subCategories") => {
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
    select: {
      orderId: true,
      quantity: true,
      total: true,
      product: {
        select: {
          categories: { select: { category: { select: { name: true } } } },
          subCategories: { select: { subCategory: { select: { name: true } } } },
        },
      },
    },
  });

  const revenue = new Map<string, number>();
  const units = new Map<string, number>();
  const orderSets = new Map<string, Set<string>>();

  for (const item of items) {
    const names =
      relation === "categories"
        ? (item.product?.categories.map((c) => c.category.name) ?? [])
        : (item.product?.subCategories.map((c) => c.subCategory.name) ?? []);
    const bucket = names.length ? names : ["Uncategorized"];

    for (const name of bucket) {
      revenue.set(name, (revenue.get(name) ?? 0) + item.total);
      units.set(name, (units.get(name) ?? 0) + item.quantity);
      const set = orderSets.get(name) ?? new Set<string>();
      set.add(item.orderId);
      orderSets.set(name, set);
    }
  }

  const totalRevenue = [...revenue.values()].reduce((sum, v) => sum + v, 0);

  return [...revenue.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([name, amount]) => ({
      name,
      revenue: round2(amount),
      unitsSold: units.get(name) ?? 0,
      orders: orderSets.get(name)?.size ?? 0,
      percentage: totalRevenue === 0 ? 0 : round1((amount / totalRevenue) * 100),
    }));
};

const getSalesByCategory = (start: Date, end: Date) => getCategoryBreakdown(start, end, "categories");
const getSalesBySubcategory = (start: Date, end: Date) => getCategoryBreakdown(start, end, "subCategories");

// ============================= §9 — Sales by Payment Method =============================

const getSalesByPaymentMethod = async (start: Date, end: Date) => {
  const payments = await prisma.payment.findMany({
    where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
    select: { paymentMethod: true, amount: true },
  });

  const map = new Map<string, { revenue: number; count: number }>();
  for (const p of payments) {
    const key = p.paymentMethod ?? "Unknown";
    const entry = map.get(key) ?? { revenue: 0, count: 0 };
    entry.revenue += Number(p.amount);
    entry.count += 1;
    map.set(key, entry);
  }

  const total = [...map.values()].reduce((sum, v) => sum + v.revenue, 0);

  return [...map.entries()].map(([method, v]) => ({
    method,
    transactions: v.count,
    revenue: round2(v.revenue),
    percentage: total === 0 ? 0 : round1((v.revenue / total) * 100),
  }));
};

// ============================= §10 — Sales by Location =============================

const getSalesByLocation = async (start: Date, end: Date) => {
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER },
    select: { state: true, totalAmount: true },
  });

  const map = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    const key = (o.state || "Unknown").trim();
    const entry = map.get(key) ?? { revenue: 0, orders: 0 };
    entry.revenue += o.totalAmount;
    entry.orders += 1;
    map.set(key, entry);
  }

  const total = [...map.values()].reduce((sum, v) => sum + v.revenue, 0);

  return [...map.entries()]
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([location, v]) => ({
      location,
      revenue: round2(v.revenue),
      orders: v.orders,
      percentage: total === 0 ? 0 : round1((v.revenue / total) * 100),
    }));
};

// ============================= §11 / §12 — Customers overview + New vs Returning =============================

const findFirstTimeSplit = async (start: Date, end: Date) => {
  const ordersInRange = await prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end }, userId: { not: null } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIds = ordersInRange.map((o) => o.userId as string);

  const priorOrders = userIds.length
    ? await prisma.order.findMany({
        where: { userId: { in: userIds }, createdAt: { lt: start } },
        select: { userId: true },
        distinct: ["userId"],
      })
    : [];
  const priorSet = new Set(priorOrders.map((o) => o.userId));

  const newCustomers = userIds.filter((id) => !priorSet.has(id)).length;
  const returningCustomers = userIds.length - newCustomers;

  return { activeCustomers: userIds.length, newCustomers, returningCustomers };
};

const getCustomersOverview = async (start: Date, end: Date) => {
  const { prevStart, prevEnd } = getPreviousRange(start, end);
  const [totalCustomers, current, previous] = await Promise.all([
    prisma.user.count({ where: { role: "CUSTOMER", isDeleted: false } }),
    findFirstTimeSplit(start, end),
    findFirstTimeSplit(prevStart, prevEnd),
  ]);

  return {
    totalCustomers,
    newCustomers: current.newCustomers,
    returningCustomers: current.returningCustomers,
    activeCustomers: current.activeCustomers,
    newCustomerGrowth: pctChange(current.newCustomers, previous.newCustomers),
    returningCustomerGrowth: pctChange(current.returningCustomers, previous.returningCustomers),
  };
};

const getNewVsReturning = async (start: Date, end: Date) => {
  const { newCustomers, returningCustomers } = await findFirstTimeSplit(start, end);
  const total = newCustomers + returningCustomers;

  return {
    newCustomers,
    returningCustomers,
    newPercentage: total === 0 ? 0 : round1((newCustomers / total) * 100),
    returningPercentage: total === 0 ? 0 : round1((returningCustomers / total) * 100),
  };
};

// ============================= §13 / §14 — Refund & Return overview + reasons =============================

const getReturnsOverview = async (start: Date, end: Date) => {
  const [totalOrders, returns] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } }),
    prisma.orderReturn.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { refundStatus: true, refundAmount: true },
    }),
  ]);

  const totalReturned = returns.length;
  const pendingRefunds = returns.filter((r) => r.refundStatus === "PENDING").length;
  const completedRefunds = returns.filter((r) => r.refundStatus === "COMPLETED").length;
  const refundedAmount = returns
    .filter((r) => r.refundStatus === "COMPLETED")
    .reduce((sum, r) => sum + (r.refundAmount ?? 0), 0);

  return {
    totalReturnedOrders: totalReturned,
    returnRate: totalOrders === 0 ? 0 : round1((totalReturned / totalOrders) * 100),
    refundRate: totalOrders === 0 ? 0 : round1((completedRefunds / totalOrders) * 100),
    pendingRefunds,
    completedRefunds,
    refundedAmount: round2(refundedAmount),
  };
};

const getReturnReasons = async (start: Date, end: Date) => {
  const groups = await prisma.orderReturn.groupBy({
    by: ["reason"],
    where: { createdAt: { gte: start, lte: end } },
    _count: { _all: true },
  });
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);

  return groups
    .map((g) => ({
      reason: g.reason,
      count: g._count._all,
      percentage: total === 0 ? 0 : round1((g._count._all / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
};

// ============================= §15 / §16 — Inventory overview + low stock =============================

const getInventorySummary = async () => {
  // Admin-configurable cutoff from the Settings page.
  const LOW_STOCK_THRESHOLD = await SettingsService.getLowStockThreshold();
  const overview = await InventoryService.getInventoryOverview();

  const lowStockAlerts = overview.products
    .filter((p) => p.totalUnits <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.totalUnits - b.totalUnits)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      image: p.image,
      currentStock: p.totalUnits,
      threshold: LOW_STOCK_THRESHOLD,
      status: p.totalUnits === 0 ? "Out of Stock" : p.totalUnits <= 3 ? "Critical" : "Low Stock",
    }));

  return {
    kpis: overview.kpis,
    stockByCategory: overview.stockByCategory,
    stockHealth: overview.stockHealth,
    lowStockAlerts,
  };
};

// ============================= §17 — Coupon performance =============================

const getCouponsPerformance = async (start: Date, end: Date) => {
  const [coupons, redemptions] = await Promise.all([
    prisma.coupon.findMany(),
    prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end }, couponId: { not: null }, orderStatus: VALID_ORDER_STATUS_FILTER },
      select: { couponId: true, discountAmount: true, totalAmount: true },
    }),
  ]);

  const redemptionMap = new Map<string, { count: number; discount: number; revenue: number }>();
  for (const order of redemptions) {
    const key = order.couponId as string;
    const entry = redemptionMap.get(key) ?? { count: 0, discount: 0, revenue: 0 };
    entry.count += 1;
    entry.discount += order.discountAmount;
    entry.revenue += order.totalAmount;
    redemptionMap.set(key, entry);
  }

  const perCoupon = coupons.map((c) => {
    const stats = redemptionMap.get(c.id) ?? { count: 0, discount: 0, revenue: 0 };
    return {
      id: c.id,
      code: c.code,
      isActive: c.isActive,
      usedCount: c.usedCount,
      periodRedemptions: stats.count,
      totalDiscountGiven: round2(stats.discount),
      revenueGenerated: round2(stats.revenue),
    };
  });

  const mostUsedCoupon = [...perCoupon].sort((a, b) => b.usedCount - a.usedCount)[0] ?? null;
  const bestPerformingCoupon = [...perCoupon].sort((a, b) => b.revenueGenerated - a.revenueGenerated)[0] ?? null;

  return {
    totalCoupons: coupons.length,
    activeCoupons: coupons.filter((c) => c.isActive).length,
    usedCoupons: coupons.filter((c) => c.usedCount > 0).length,
    totalDiscountGiven: round2(perCoupon.reduce((sum, c) => sum + c.totalDiscountGiven, 0)),
    revenueGenerated: round2(perCoupon.reduce((sum, c) => sum + c.revenueGenerated, 0)),
    mostUsedCoupon,
    bestPerformingCoupon,
    coupons: perCoupon,
  };
};

// ============================= §18 — Discount performance =============================

const getDiscountsPerformance = async (start: Date, end: Date) => {
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
    select: {
      total: true,
      quantity: true,
      price: true,
      orderId: true,
      product: { select: { regularPrice: true } },
    },
  });

  let totalDiscount = 0;
  let revenueAfterDiscount = 0;
  const discountedOrderIds = new Set<string>();

  for (const item of items) {
    const regular = item.product?.regularPrice ?? item.price;
    const lineDiscount = Math.max(regular - item.price, 0) * item.quantity;
    if (lineDiscount > 0) discountedOrderIds.add(item.orderId);
    totalDiscount += lineDiscount;
    revenueAfterDiscount += item.total;
  }

  const [activeDiscounts, totalOrders] = await Promise.all([
    prisma.discount.count({ where: { isActive: true } }),
    prisma.order.count({ where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } }),
  ]);

  return {
    activeDiscounts,
    totalDiscount: round2(totalDiscount),
    avgDiscountPerOrder: discountedOrderIds.size === 0 ? 0 : round2(totalDiscount / discountedOrderIds.size),
    discountedOrders: discountedOrderIds.size,
    revenueAfterDiscount: round2(revenueAfterDiscount),
    discountPercentage:
      revenueAfterDiscount + totalDiscount === 0
        ? 0
        : round1((totalDiscount / (revenueAfterDiscount + totalDiscount)) * 100),
    totalOrders,
  };
};

// ============================= §19 — Sales funnel =============================

const countDistinctSessions = async (type: string, start: Date, end: Date) => {
  const rows = await prisma.analyticsEvent.findMany({
    where: { type: type as any, createdAt: { gte: start, lte: end } },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  return rows.length;
};

const getSalesFunnel = async (start: Date, end: Date) => {
  const [pageViews, productViews, addToCarts, checkoutStarts, purchases] = await Promise.all([
    countDistinctSessions("PAGE_VIEW", start, end),
    countDistinctSessions("PRODUCT_VIEW", start, end),
    countDistinctSessions("ADD_TO_CART", start, end),
    countDistinctSessions("CHECKOUT_START", start, end),
    prisma.order.count({ where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } }),
  ]);

  const stages = [
    { stage: "Visitors", value: pageViews },
    { stage: "Product Views", value: productViews },
    { stage: "Add to Cart", value: addToCarts },
    { stage: "Checkout", value: checkoutStarts },
    { stage: "Purchase", value: purchases },
  ];

  return stages.map((s, i) => ({
    ...s,
    conversionFromPrevious:
      i === 0 || stages[i - 1].value === 0 ? 100 : round1((s.value / stages[i - 1].value) * 100),
    conversionFromStart: pageViews === 0 ? 0 : round1((s.value / pageViews) * 100),
  }));
};

// ============================= §22 — Product performance =============================

const getProductPerformance = async (start: Date, end: Date, limit: number) => {
  const [viewGroups, cartGroups, orderGroups, returns] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ["productId"],
      where: { type: "PRODUCT_VIEW", createdAt: { gte: start, lte: end }, productId: { not: null } },
      _count: { _all: true },
    }),
    prisma.analyticsEvent.groupBy({
      by: ["productId"],
      where: { type: "ADD_TO_CART", createdAt: { gte: start, lte: end }, productId: { not: null } },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
      _sum: { quantity: true, total: true },
      _count: { _all: true },
    }),
    prisma.orderReturn.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { order: { select: { items: { select: { productId: true } } } } },
    }),
  ]);

  const returnCountByProduct = new Map<string, number>();
  for (const r of returns) {
    for (const item of r.order.items) {
      returnCountByProduct.set(item.productId, (returnCountByProduct.get(item.productId) ?? 0) + 1);
    }
  }

  const viewMap = new Map(viewGroups.map((g) => [g.productId as string, g._count._all]));
  const cartMap = new Map(cartGroups.map((g) => [g.productId as string, g._count._all]));

  const productIds = [...new Set(orderGroups.map((g) => g.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(products.map((p) => [p.id, p.name]));

  const rows = orderGroups.map((g) => {
    const views = viewMap.get(g.productId) ?? 0;
    const orders = g._count._all;
    return {
      productId: g.productId,
      name: nameMap.get(g.productId) ?? "Unknown product",
      views,
      addToCart: cartMap.get(g.productId) ?? 0,
      orders,
      unitsSold: g._sum.quantity ?? 0,
      revenue: round2(g._sum.total ?? 0),
      conversionRate: views === 0 ? 0 : round1((orders / views) * 100),
      returnRate: orders === 0 ? 0 : round1(((returnCountByProduct.get(g.productId) ?? 0) / orders) * 100),
    };
  });

  return rows.sort((a, b) => b.revenue - a.revenue).slice(0, limit);
};

// ============================= §26 — Sales target =============================

const monthKey = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);

const getSalesTarget = async () => {
  const month = monthKey();
  const [target, revenueAgg] = await Promise.all([
    prisma.salesTarget.findUnique({ where: { month } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: month, lte: new Date() }, orderStatus: VALID_ORDER_STATUS_FILTER },
      _sum: { totalAmount: true },
    }),
  ]);

  const targetAmount = target?.targetAmount ?? 0;
  const currentRevenue = round2(revenueAgg._sum.totalAmount ?? 0);

  return {
    month: month.toISOString().slice(0, 7),
    targetAmount,
    currentRevenue,
    remainingRevenue: Math.max(round2(targetAmount - currentRevenue), 0),
    completionPercentage: targetAmount === 0 ? 0 : round1(Math.min((currentRevenue / targetAmount) * 100, 100)),
  };
};

const updateSalesTarget = async (targetAmount: number) => {
  const month = monthKey();
  await prisma.salesTarget.upsert({
    where: { month },
    update: { targetAmount },
    create: { month, targetAmount },
  });
  return getSalesTarget();
};

// ============================= §27 — Daily snapshot =============================

const getDailySnapshot = async () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

  const [revenueAgg, orders, itemsAgg, todayCustomerRows, returns, discounts] = await Promise.all([
    prisma.order.aggregate({
      where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER },
      _sum: { totalAmount: true },
    }),
    prisma.order.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.orderItem.aggregate({
      where: { order: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER } },
      _sum: { quantity: true },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end }, userId: { not: null } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.orderReturn.count({ where: { createdAt: { gte: start, lte: end } } }),
    getDiscountsPerformance(start, end),
  ]);

  const todayCustomerIds = todayCustomerRows.map((o) => o.userId as string);
  const priorOrders = todayCustomerIds.length
    ? await prisma.order.findMany({
        where: { userId: { in: todayCustomerIds }, createdAt: { lt: start } },
        select: { userId: true },
        distinct: ["userId"],
      })
    : [];
  const priorSet = new Set(priorOrders.map((o) => o.userId));
  const newCustomers = todayCustomerIds.filter((id) => !priorSet.has(id)).length;
  const returningCustomers = todayCustomerIds.length - newCustomers;

  return {
    date: start.toISOString().slice(0, 10),
    revenue: round2(revenueAgg._sum.totalAmount ?? 0),
    orders,
    productsSold: itemsAgg._sum.quantity ?? 0,
    newCustomers,
    returningCustomers,
    refunds: returns,
    discounts: discounts.totalDiscount,
  };
};

// ============================= §28 / §29 — Best customers + CLV =============================

const getBestCustomers = async (limit: number) => {
  const grouped = await prisma.order.groupBy({
    by: ["userId"],
    where: { userId: { not: null }, orderStatus: VALID_ORDER_STATUS_FILTER },
    _sum: { totalAmount: true },
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _sum: { totalAmount: "desc" } },
    take: limit,
  });

  const userIds = grouped.map((g) => g.userId as string);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return grouped.map((g) => {
    const user = userMap.get(g.userId as string);
    const totalSpent = g._sum.totalAmount ?? 0;
    const totalOrders = g._count._all;
    return {
      userId: g.userId as string,
      name: user?.name ?? "Guest",
      email: user?.email ?? null,
      totalOrders,
      totalSpent: round2(totalSpent),
      avgOrderValue: totalOrders === 0 ? 0 : round2(totalSpent / totalOrders),
      lastOrderDate: g._max.createdAt,
    };
  });
};

const getCustomerLifetimeValue = async () => {
  const grouped = await prisma.order.groupBy({
    by: ["userId"],
    where: { userId: { not: null }, orderStatus: VALID_ORDER_STATUS_FILTER },
    _sum: { totalAmount: true },
    _count: { _all: true },
  });

  const values = grouped.map((g) => g._sum.totalAmount ?? 0);
  const totalRevenue = values.reduce((sum, v) => sum + v, 0);
  const avgCLV = grouped.length === 0 ? 0 : totalRevenue / grouped.length;
  const highestCLV = values.length === 0 ? 0 : Math.max(...values);
  const repeatCustomers = grouped.filter((g) => g._count._all > 1).length;

  return {
    averageCLV: round2(avgCLV),
    highestCLV: round2(highestCLV),
    totalCustomerRevenue: round2(totalRevenue),
    repeatPurchaseRate: grouped.length === 0 ? 0 : round1((repeatCustomers / grouped.length) * 100),
  };
};

// ============================= §33 — Alerts / Notifications =============================
// Backs the dashboard header's notification bell. Every entry is derived from a real row
// (order, payment, product stock level, or return) — there's no persisted "notification"
// table, so read/unread state is tracked client-side against these stable `id`s.

export type NotificationType = "stock" | "order" | "shipment" | "product" | "analytics" | "system";

export interface AlertNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  link: string;
}

const getAlerts = async (): Promise<AlertNotification[]> => {
  // Admin-configurable cutoff from the Settings page.
  const LOW_STOCK_THRESHOLD = await SettingsService.getLowStockThreshold();
  const [recentOrders, recentPayments, inventoryOverview, pendingReturns, failedPayments] = await Promise.all([
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, orderNo: true, name: true, totalAmount: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: { paymentStatus: "PAID" },
      orderBy: { paidAt: "desc" },
      take: 5,
      select: { id: true, orderNo: true, amount: true, paidAt: true },
    }),
    InventoryService.getInventoryOverview(),
    prisma.orderReturn.findMany({
      where: { status: "REQUESTED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { order: { select: { orderNo: true } } },
    }),
    prisma.payment.findMany({
      where: { paymentStatus: "FAILED" },
      orderBy: { failedAt: "desc" },
      take: 5,
      select: { id: true, orderNo: true, failedAt: true },
    }),
  ]);

  const alerts: Array<AlertNotification & { createdAt: Date }> = [];

  for (const o of recentOrders) {
    alerts.push({
      id: `order-${o.id}`,
      type: "order",
      title: "New order placed",
      message: `${o.orderNo} from ${o.name} — ৳${o.totalAmount}`,
      link: "/admin/orders",
      createdAt: o.createdAt,
      timestamp: o.createdAt.toISOString(),
    });
  }
  for (const p of recentPayments) {
    if (p.paidAt) {
      alerts.push({
        id: `payment-${p.id}`,
        type: "order",
        title: "Payment received",
        message: `${p.orderNo} — ৳${p.amount}`,
        link: "/admin/orders",
        createdAt: p.paidAt,
        timestamp: p.paidAt.toISOString(),
      });
    }
  }
  for (const p of inventoryOverview.products) {
    const now = new Date();
    if (p.totalUnits === 0) {
      alerts.push({
        id: `stock-out-${p.id}`,
        type: "stock",
        title: "Out of stock",
        message: `${p.name} is out of stock`,
        link: "/admin/inventory-management",
        createdAt: now,
        timestamp: now.toISOString(),
      });
    } else if (p.totalUnits <= LOW_STOCK_THRESHOLD) {
      alerts.push({
        id: `stock-low-${p.id}`,
        type: "stock",
        title: "Low stock alert",
        message: `${p.name} has only ${p.totalUnits} units left`,
        link: "/admin/inventory-management",
        createdAt: now,
        timestamp: now.toISOString(),
      });
    }
  }
  for (const r of pendingReturns) {
    alerts.push({
      id: `return-${r.id}`,
      type: "shipment",
      title: "Return requested",
      message: `Order ${r.order.orderNo}`,
      link: "/admin/orders",
      createdAt: r.createdAt,
      timestamp: r.createdAt.toISOString(),
    });
  }
  for (const p of failedPayments) {
    if (p.failedAt) {
      alerts.push({
        id: `payment-failed-${p.id}`,
        type: "system",
        title: "Payment failed",
        message: `Order ${p.orderNo}`,
        link: "/admin/orders",
        createdAt: p.failedAt,
        timestamp: p.failedAt.toISOString(),
      });
    }
  }

  return alerts
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map(({ createdAt: _createdAt, ...rest }) => rest);
};

// ============================= §34 — Business performance rollup =============================

const getBusinessPerformance = async (start: Date, end: Date) => {
  const [summary, returns] = await Promise.all([getSummary(start, end), getReturnsOverview(start, end)]);

  return {
    revenue: summary.revenue,
    orders: summary.orders,
    customers: summary.customers,
    productsSold: summary.productsSold,
    aov: summary.aov,
    conversionRate: summary.conversionRate,
    returnRate: returns.returnRate,
    refundRate: returns.refundRate,
    growthRate: summary.revenue.change,
    // Profit isn't computable — there's no cost-of-goods field anywhere in the schema.
    profit: null,
  };
};

export {
  getSummary,
  getRevenueChart,
  getCategoryRevenueSeries,
  getOrderStatusOverview,
  getRecentOrders,
  getTopProducts,
  getSalesByCategory,
  getSalesBySubcategory,
  getSalesByPaymentMethod,
  getSalesByLocation,
  getCustomersOverview,
  getNewVsReturning,
  getReturnsOverview,
  getReturnReasons,
  getInventorySummary,
  getCouponsPerformance,
  getDiscountsPerformance,
  getSalesFunnel,
  getProductPerformance,
  getSalesTarget,
  updateSalesTarget,
  getDailySnapshot,
  getBestCustomers,
  getCustomerLifetimeValue,
  getAlerts,
  getBusinessPerformance,
};

export const StatsService = {
  getSummary,
  getRevenueChart,
  getCategoryRevenueSeries,
  getOrderStatusOverview,
  getRecentOrders,
  getTopProducts,
  getSalesByCategory,
  getSalesBySubcategory,
  getSalesByPaymentMethod,
  getSalesByLocation,
  getCustomersOverview,
  getNewVsReturning,
  getReturnsOverview,
  getReturnReasons,
  getInventorySummary,
  getCouponsPerformance,
  getDiscountsPerformance,
  getSalesFunnel,
  getProductPerformance,
  getSalesTarget,
  updateSalesTarget,
  getDailySnapshot,
  getBestCustomers,
  getCustomerLifetimeValue,
  getAlerts,
  getBusinessPerformance,
};
