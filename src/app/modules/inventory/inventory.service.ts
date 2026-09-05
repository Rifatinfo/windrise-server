import { OrderStatus, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";

const LOW_STOCK_THRESHOLD = 10;
const VELOCITY_WINDOW_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

// Inclusive date range selected on the dashboard; defaults to the last 28 days
export interface InventoryDateRange {
  start: Date;
  end: Date;
}

const CATEGORY_COLORS = [
  "#5b5bf5",
  "#2563eb",
  "#0d9488",
  "#f59e0b",
  "#e5484d",
  "#8b5cf6",
  "#64748b",
];

const CATEGORY_EMOJI: Record<string, string> = {
  jeans: "👖",
  pant: "👖",
  trouser: "👖",
  "t-shirt": "👕",
  tshirt: "👕",
  polo: "👕",
  shirt: "👔",
  panjabi: "🥻",
  kurti: "👗",
  dress: "👗",
  jacket: "🧥",
  hoodie: "🧥",
  sweat: "🧥",
  shoe: "👟",
  sneaker: "👟",
  boot: "🥾",
  bag: "👜",
  cap: "🧢",
  hat: "🧢",
  watch: "⌚",
  saree: "🥻",
  skirt: "👗",
  shorts: "🩳",
  kid: "🧒",
};

const emojiForCategory = (category: string): string => {
  const needle = category.toLowerCase();
  const match = Object.keys(CATEGORY_EMOJI).find((key) => needle.includes(key));
  return match ? CATEGORY_EMOJI[match] : "📦";
};

const round1 = (value: number) => Math.round(value * 10) / 10;

// ============ Sales velocity: units sold per product within the selected range ============
const getWeeklySalesMap = async (
  range?: InventoryDateRange,
): Promise<{
  weekly: Map<string, number>;
  windowDays: number;
  weeksInWindow: number;
}> => {
  const end = range?.end ?? new Date();
  const start =
    range?.start ?? new Date(end.getTime() - VELOCITY_WINDOW_DAYS * DAY_MS);
  const weeksInWindow = Math.max(
    (end.getTime() - start.getTime()) / (7 * DAY_MS),
    1 / 7,
  );
  const windowDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / DAY_MS),
  );

  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        createdAt: { gte: start, lte: end },
        orderStatus: {
          notIn: [OrderStatus.CANCELED, OrderStatus.FAILED, OrderStatus.EXPIRED],
        },
      },
    },
    select: { productId: true, quantity: true },
  });

  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }

  const weekly = new Map<string, number>();
  for (const [productId, quantity] of totals) {
    weekly.set(productId, round1(quantity / weeksInWindow));
  }
  return { weekly, windowDays, weeksInWindow };
};

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    categories: { include: { category: true } };
    subCategories: { include: { subCategory: true } };
    variants: true;
    images: { select: { url: true } };
  };
}>;

const toInventoryProduct = (
  product: ProductWithRelations,
  weeklySalesMap: Map<string, number>,
) => {
  // ============ Aggregate variant quantities per size ============
  const sizeMap = new Map<string, number>();
  for (const variant of product.variants) {
    const size = variant.size?.trim() || "One Size";
    sizeMap.set(size, (sizeMap.get(size) ?? 0) + variant.quantity);
  }

  const sizes = [...sizeMap.entries()].map(([size, units]) => ({
    size,
    units,
    reorderPoint: LOW_STOCK_THRESHOLD,
  }));

  // Products without variants expose a single synthetic size so the UI stays uniform
  if (sizes.length === 0) {
    sizes.push({
      size: "One Size",
      units: product.stockQuantity ?? 0,
      reorderPoint: LOW_STOCK_THRESHOLD,
    });
  }

  const totalUnits = sizes.reduce((sum, size) => sum + size.units, 0);

  const category = product.categories[0]?.category.name ?? "Uncategorized";
  const subcategory = product.subCategories[0]?.subCategory.name ?? "General";
  const price = product.salePrice ?? product.regularPrice ?? 0;

  const avgWeeklySales = weeklySalesMap.get(product.id) ?? 0;
  // Suggested order: enough stock to cover 4 weeks of demand
  const reorderQty = Math.max(Math.ceil(avgWeeklySales * 4) - totalUnits, 0);

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category,
    subcategory,
    emoji: emojiForCategory(category),
    image: product.thumbnailImage ?? product.images[0]?.url ?? null,
    price,
    sizes,
    totalUnits,
    avgWeeklySales,
    reorderQty,
  };
};

type InventoryProduct = ReturnType<typeof toInventoryProduct>;

const statusOf = (product: InventoryProduct) => {
  if (product.totalUnits === 0) return "out-of-stock";
  if (product.sizes.some((size) => size.units <= size.reorderPoint)) {
    return "low-stock";
  }
  return "in-stock";
};

const daysUntilStockout = (product: InventoryProduct) => {
  if (product.totalUnits === 0) return 0;
  if (product.avgWeeklySales <= 0) return 999;
  return Math.ceil((product.totalUnits / product.avgWeeklySales) * 7);
};

const getInventoryOverview = async (range?: InventoryDateRange) => {
  const [products, salesWindow] = await Promise.all([
    prisma.product.findMany({
      where: { isDeleted: false },
      include: {
        categories: { include: { category: true } },
        subCategories: { include: { subCategory: true } },
        variants: true,
        images: { select: { url: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
    getWeeklySalesMap(range),
  ]);
  const { weekly: weeklySalesMap, windowDays, weeksInWindow } = salesWindow;

  const items = products.map((product) => toInventoryProduct(product, weeklySalesMap));

  // ============ KPI strip ============
  const totalSkus = items.length;
  const totalUnits = items.reduce((sum, item) => sum + item.totalUnits, 0);
  const inStockCount = items.filter((item) => statusOf(item) === "in-stock").length;
  const lowStockCount = items.filter((item) => statusOf(item) === "low-stock").length;
  const outOfStockCount = items.filter(
    (item) => statusOf(item) === "out-of-stock",
  ).length;

  const percent = (value: number) =>
    totalSkus === 0 ? "0%" : `${Math.round((value / totalSkus) * 100)}% of SKUs`;

  const kpis = [
    {
      id: "total-skus",
      label: "Total SKUs",
      value: totalSkus.toLocaleString("en-US"),
      delta: `${items.reduce((sum, item) => sum + item.sizes.length, 0)} size runs`,
      icon: "box",
      tone: "muted",
    },
    {
      id: "total-units",
      label: "Units on Hand",
      value: totalUnits.toLocaleString("en-US"),
      delta: "Across all sizes",
      icon: "box",
      tone: "muted",
    },
    {
      id: "healthy",
      label: "Healthy SKUs",
      value: inStockCount.toLocaleString("en-US"),
      delta: percent(inStockCount),
      icon: "check",
      tone: "good",
    },
    {
      id: "low-stock",
      label: "Low Stock",
      value: lowStockCount.toLocaleString("en-US"),
      delta: percent(lowStockCount),
      icon: "alert",
      tone: "warn",
    },
    {
      id: "out-of-stock",
      label: "Out of Stock",
      value: outOfStockCount.toLocaleString("en-US"),
      delta: percent(outOfStockCount),
      icon: "x",
      tone: "bad",
    },
  ];

  // ============ Business analytics cards ============
  const inventoryValue = items.reduce(
    (sum, item) => sum + item.totalUnits * item.price,
    0,
  );
  const healthyUnits = items
    .filter((item) => statusOf(item) === "in-stock")
    .reduce((sum, item) => sum + item.totalUnits, 0);
  const healthyUnitsPercent =
    totalUnits === 0 ? 0 : Math.round((healthyUnits / totalUnits) * 100);

  const soldInWindow = [...weeklySalesMap.values()].reduce(
    (sum, weekly) => sum + weekly * weeksInWindow,
    0,
  );
  const sellThroughPercent =
    totalUnits + soldInWindow === 0
      ? 0
      : Math.min(
          100,
          Math.round((soldInWindow / (totalUnits + soldInWindow)) * 100),
        );

  const needReorder = items.filter(
    (item) => item.totalUnits === 0 || daysUntilStockout(item) <= 21,
  );
  const avgDaysToStockout =
    items.length === 0
      ? 0
      : Math.round(
          items.reduce((sum, item) => sum + daysUntilStockout(item), 0) /
            items.length,
        );

  const formatTkCompact = (value: number) =>
    value >= 100000
      ? `৳${(value / 100000).toFixed(1)}L`
      : `৳${Math.round(value).toLocaleString("en-US")}`;

  const analyticsCards = [
    {
      id: "inventory-value",
      icon: "currency",
      accent: "violet",
      label: "Inventory Value",
      value: formatTkCompact(inventoryValue),
      suffix: "",
      detail: "Retail value of all units currently on hand",
      trend: `${healthyUnitsPercent}% healthy stock`,
      trendTone: healthyUnitsPercent >= 60 ? "good" : "bad",
      footnote: "at sale price",
      ringPercent: healthyUnitsPercent,
      ringLabel: `${healthyUnitsPercent}%`,
    },
    {
      id: "sell-through",
      icon: "trend",
      accent: "blue",
      label: `Sell-Through (${windowDays}d)`,
      value: `${sellThroughPercent}`,
      suffix: "%",
      detail: `${Math.round(soldInWindow).toLocaleString("en-US")} units sold in the last ${windowDays} days`,
      trend: sellThroughPercent >= 20 ? "Healthy pace" : "Slow moving",
      trendTone: sellThroughPercent >= 20 ? "good" : "bad",
      footnote: "of available units",
      ringPercent: sellThroughPercent,
      ringLabel: `${sellThroughPercent}%`,
    },
    {
      id: "restock",
      icon: "cycle",
      accent: "red",
      label: "SKUs Need Restock",
      value: needReorder.length.toLocaleString("en-US"),
      suffix: "",
      detail: "Out of stock now or running out within 3 weeks",
      trend:
        needReorder.length === 0
          ? "Nothing urgent"
          : `${needReorder.filter((item) => item.totalUnits === 0).length} already out`,
      trendTone: needReorder.length === 0 ? "good" : "bad",
      badge: {
        tone: needReorder.length === 0 ? "good" : "bad",
        text: needReorder.length === 0 ? "All good" : "Action needed",
      },
      ringPercent:
        totalSkus === 0
          ? 0
          : Math.round((needReorder.length / totalSkus) * 100),
      ringLabel: `${totalSkus === 0 ? 0 : Math.round((needReorder.length / totalSkus) * 100)}%`,
    },
    {
      id: "avg-stockout",
      icon: "clock",
      accent: "teal",
      label: "Avg Days to Stockout",
      value: avgDaysToStockout >= 999 ? "90+" : `${avgDaysToStockout}`,
      suffix: avgDaysToStockout >= 999 ? "" : "days",
      detail: "Average across all SKUs at the current sales pace",
      trend: avgDaysToStockout >= 30 ? "Comfortable cover" : "Thin cover",
      trendTone: avgDaysToStockout >= 30 ? "good" : "bad",
      footnote: "per SKU",
      ringPercent: Math.min(100, Math.round((avgDaysToStockout / 90) * 100)),
      ringLabel: `${Math.min(100, Math.round((avgDaysToStockout / 90) * 100))}%`,
    },
  ];

  // ============ Stock by category ============
  const categoryMap = new Map<string, number>();
  for (const product of products) {
    const units =
      product.variants.length > 0
        ? product.variants.reduce((sum, variant) => sum + variant.quantity, 0)
        : (product.stockQuantity ?? 0);
    const names = product.categories.length
      ? product.categories.map((c) => c.category.name)
      : ["Uncategorized"];
    for (const name of names) {
      categoryMap.set(name, (categoryMap.get(name) ?? 0) + units);
    }
  }
  const stockByCategory = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, units], index) => ({
      name,
      units,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));

  // ============ Stock health ============
  const healthPercent = (value: number) =>
    totalSkus === 0 ? 0 : Math.round((value / totalSkus) * 100);
  const stockHealth = [
    {
      label: "In Stock",
      percent: healthPercent(inStockCount),
      color: "#16a34a",
    },
    {
      label: "Low Stock",
      percent: healthPercent(lowStockCount),
      color: "#f59e0b",
    },
    {
      label: "Out of Stock",
      percent: healthPercent(outOfStockCount),
      color: "#e5484d",
    },
  ];

  return {
    kpis,
    analyticsCards,
    stockByCategory,
    stockHealth,
    totalSkus,
    products: items,
  };
};

// ============ Adjust stock per size, then return the fresh overview ============
const adjustProductStock = async (
  productId: string,
  deltas: Record<string, number>,
  range?: InventoryDateRange,
) => {
  if (!deltas || typeof deltas !== "object" || Array.isArray(deltas)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "deltas must be an object of size -> quantity change");
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: true },
  });

  if (!product || product.isDeleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");
  }

  await prisma.$transaction(async (tx) => {
    let totalDelta = 0;

    if (product.variants.length > 0) {
      // Group variants by size; apply each delta to the first variant of that size
      const variantsBySize = new Map<string, typeof product.variants>();
      for (const variant of product.variants) {
        const size = variant.size?.trim() || "One Size";
        const group = variantsBySize.get(size) ?? [];
        group.push(variant);
        variantsBySize.set(size, group);
      }

      for (const [size, rawDelta] of Object.entries(deltas)) {
        const delta = Math.trunc(Number(rawDelta));
        if (!Number.isFinite(delta) || delta === 0) continue;

        const group = variantsBySize.get(size);
        if (!group || group.length === 0) continue;

        const sizeTotal = group.reduce((sum, variant) => sum + variant.quantity, 0);
        const appliedDelta = Math.max(delta, -sizeTotal);
        if (appliedDelta === 0) continue;

        const target = group[0];
        await tx.variant.update({
          where: { id: target.id },
          data: { quantity: target.quantity + appliedDelta },
        });
        totalDelta += appliedDelta;
      }

      const variants = await tx.variant.findMany({ where: { productId } });
      const newTotal = variants.reduce((sum, variant) => sum + variant.quantity, 0);
      const lowThreshold = Math.max(LOW_STOCK_THRESHOLD, 1);
      const stockStatus =
        newTotal === 0
          ? "OUT_OF_STOCK"
          : variants.some((variant) => variant.quantity <= lowThreshold)
            ? "LOW_STOCK"
            : "IN_STOCK";

      await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: newTotal, stockStatus },
      });
    } else {
      // No variants: adjust the flat stockQuantity
      const rawTotal = Object.values(deltas).reduce(
        (sum, value) => sum + Math.trunc(Number(value) || 0),
        0,
      );
      const current = product.stockQuantity ?? 0;
      const newTotal = Math.max(0, current + rawTotal);
      totalDelta = newTotal - current;

      await tx.product.update({
        where: { id: productId },
        data: {
          stockQuantity: newTotal,
          stockStatus:
            newTotal === 0
              ? "OUT_OF_STOCK"
              : newTotal <= LOW_STOCK_THRESHOLD
                ? "LOW_STOCK"
                : "IN_STOCK",
        },
      });
    }

    return totalDelta;
  });

  return getInventoryOverview(range);
};

export const InventoryService = {
  getInventoryOverview,
  adjustProductStock,
};
