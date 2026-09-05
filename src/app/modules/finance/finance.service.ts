import { StatusCodes } from "http-status-codes";
import { OrderStatus, Prisma } from "@prisma/client";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";

/** Buckets seeded on first use, matching how the business already talks about spend. */
const DEFAULT_CATEGORIES = [
  { name: "Materials & Production", color: "#6366f1", sortOrder: 1 },
  { name: "Salaries & Overhead", color: "#64748b", sortOrder: 2 },
  { name: "Marketing & Ads", color: "#14b8a6", sortOrder: 3 },
  { name: "Warehousing", color: "#a78bfa", sortOrder: 4 },
  { name: "Shipping & Logistics", color: "#f59e0b", sortOrder: 5 },
  { name: "Packaging", color: "#3b82f6", sortOrder: 6 },
  { name: "Other", color: "#94a3b8", sortOrder: 7 },
];

export const seedDefaultCategories = async () => {
  const existing = await prisma.expenseCategory.count();
  if (existing > 0) return;

  await prisma.expenseCategory.createMany({
    data: DEFAULT_CATEGORIES.map((entry) => ({ ...entry, isSystem: true })),
  });
};

/** "2026-08" for a given date. */
const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const monthRange = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
};

/**
 * What the orders table actually took in for a month. Only orders that were
 * delivered or paid count — anything cancelled or still unpaid would inflate
 * the figure.
 */
const actualRevenueFor = async (key: string) => {
  const { start, end } = monthRange(key);
  const result = await prisma.order.aggregate({
    _sum: { totalAmount: true },
    where: {
      createdAt: { gte: start, lt: end },
      OR: [{ orderStatus: OrderStatus.DELIVERED }, { paymentStatus: "PAID" }],
    },
  });
  return result._sum.totalAmount ?? 0;
};

/** The confirmed figure if an admin set one, otherwise what the orders show. */
const revenueFor = async (key: string) => {
  const stored = await prisma.financeRevenue.findUnique({ where: { month: key } });
  const actual = await actualRevenueFor(key);
  return {
    amount: stored?.amount ?? actual,
    actual,
    isManual: Boolean(stored),
  };
};

const investmentTotalFor = async (key: string) => {
  const { start, end } = monthRange(key);
  const result = await prisma.investment.aggregate({
    _sum: { amount: true },
    where: { spentAt: { gte: start, lt: end } },
  });
  return result._sum.amount ?? 0;
};

const getOverview = async (month?: string) => {
  await seedDefaultCategories();

  const key = month ?? monthKey(new Date());
  const { start, end } = monthRange(key);

  const [investment, revenue, categories, rows] = await Promise.all([
    investmentTotalFor(key),
    revenueFor(key),
    prisma.expenseCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.investment.groupBy({
      by: ["categoryId"],
      _sum: { amount: true },
      where: { spentAt: { gte: start, lt: end } },
    }),
  ]);

  const spendByCategory = new Map(rows.map((row) => [row.categoryId, row._sum.amount ?? 0]));

  const byCategory = categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      amount: spendByCategory.get(category.id) ?? 0,
      percent: investment > 0 ? ((spendByCategory.get(category.id) ?? 0) / investment) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Six months ending with the selected one, oldest first.
  const [year, monthNumber] = key.split("-").map(Number);
  const series = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(year, monthNumber - 1 - offset, 1);
    const seriesKey = monthKey(date);
    series.push({
      month: seriesKey,
      label: date.toLocaleDateString("en-US", { month: "short" }),
      revenue: (await revenueFor(seriesKey)).amount,
      investment: await investmentTotalFor(seriesKey),
    });
  }

  const grossProfit = revenue.amount - investment;

  return {
    month: key,
    totalInvestment: investment,
    revenue: revenue.amount,
    actualOrderRevenue: revenue.actual,
    revenueIsManual: revenue.isManual,
    grossProfit,
    /** Return on spend. Undefined without spend, rather than a fake 0%. */
    roi: investment > 0 ? Number(((grossProfit / investment) * 100).toFixed(1)) : null,
    profitMargin:
      revenue.amount > 0 ? Number(((grossProfit / revenue.amount) * 100).toFixed(1)) : null,
    byCategory,
    series,
  };
};

const setRevenue = async (month: string, amount: number) => {
  const row = await prisma.financeRevenue.upsert({
    where: { month },
    update: { amount },
    create: { month, amount },
  });
  return { month: row.month, amount: row.amount };
};

// -------------------------------- Categories --------------------------------

const listCategories = async () => {
  await seedDefaultCategories();
  const rows = await prisma.expenseCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { investments: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isSystem: row.isSystem,
    investmentCount: row._count.investments,
  }));
};

const createCategory = async (payload: { name: string; color?: string }) => {
  const clash = await prisma.expenseCategory.findUnique({ where: { name: payload.name.trim() } });
  if (clash) throw new ApiError(StatusCodes.CONFLICT, "That category already exists");

  const last = await prisma.expenseCategory.findFirst({ orderBy: { sortOrder: "desc" } });
  return prisma.expenseCategory.create({
    data: {
      name: payload.name.trim(),
      color: payload.color ?? "#6366f1",
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
};

const updateCategory = async (id: string, payload: { name?: string; color?: string }) => {
  const existing = await prisma.expenseCategory.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Category not found");

  if (payload.name && payload.name.trim() !== existing.name) {
    const clash = await prisma.expenseCategory.findUnique({ where: { name: payload.name.trim() } });
    if (clash) throw new ApiError(StatusCodes.CONFLICT, "That category already exists");
  }

  return prisma.expenseCategory.update({
    where: { id },
    data: {
      ...(payload.name && { name: payload.name.trim() }),
      ...(payload.color && { color: payload.color }),
    },
  });
};

const deleteCategory = async (id: string) => {
  const existing = await prisma.expenseCategory.findUnique({
    where: { id },
    include: { _count: { select: { investments: true } } },
  });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Category not found");

  if (existing.isSystem) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Built-in categories cannot be deleted");
  }
  // Deleting would orphan the spend and silently change every total.
  if (existing._count.investments > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `${existing._count.investments} logged cost(s) use this category. Move or delete them first.`,
    );
  }

  await prisma.expenseCategory.delete({ where: { id } });
  return { id };
};

// -------------------------------- Investments -------------------------------

const INVESTMENT_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  product: { select: { id: true, name: true, sku: true } },
} satisfies Prisma.InvestmentInclude;

const shape = (row: Prisma.InvestmentGetPayload<{ include: typeof INVESTMENT_INCLUDE }>) => ({
  id: row.id,
  amount: row.amount,
  description: row.description,
  spentAt: row.spentAt.toISOString(),
  vendor: row.vendor,
  category: row.category,
  categoryId: row.categoryId,
  product: row.product,
  productId: row.productId,
  createdAt: row.createdAt.toISOString(),
});

export type InvestmentPayload = {
  amount: number;
  description: string;
  spentAt: string;
  vendor?: string | null;
  categoryId: string;
  productId?: string | null;
};

const listInvestments = async (filters: {
  month?: string;
  categoryId?: string;
  searchTerm?: string;
  limit?: number;
}) => {
  const where: Prisma.InvestmentWhereInput = {
    ...(filters.month
      ? {
          spentAt: {
            gte: monthRange(filters.month).start,
            lt: monthRange(filters.month).end,
          },
        }
      : {}),
    ...(filters.categoryId && filters.categoryId !== "ALL"
      ? { categoryId: filters.categoryId }
      : {}),
    ...(filters.searchTerm
      ? {
          OR: [
            { description: { contains: filters.searchTerm, mode: "insensitive" } },
            { vendor: { contains: filters.searchTerm, mode: "insensitive" } },
            { product: { name: { contains: filters.searchTerm, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.investment.findMany({
    where,
    include: INVESTMENT_INCLUDE,
    orderBy: { spentAt: "desc" },
    take: Number(filters.limit) > 0 ? Number(filters.limit) : 50,
  });

  return rows.map(shape);
};

const createInvestment = async (payload: InvestmentPayload, userId?: string) => {
  const category = await prisma.expenseCategory.findUnique({ where: { id: payload.categoryId } });
  if (!category) throw new ApiError(StatusCodes.BAD_REQUEST, "Pick a valid category");

  const row = await prisma.investment.create({
    data: {
      amount: payload.amount,
      description: payload.description.trim(),
      spentAt: new Date(payload.spentAt),
      vendor: payload.vendor?.trim() || null,
      categoryId: payload.categoryId,
      productId: payload.productId || null,
      createdById: userId ?? null,
    },
    include: INVESTMENT_INCLUDE,
  });
  return shape(row);
};

const updateInvestment = async (id: string, payload: Partial<InvestmentPayload>) => {
  const existing = await prisma.investment.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Entry not found");

  const row = await prisma.investment.update({
    where: { id },
    data: {
      ...(payload.amount !== undefined && { amount: payload.amount }),
      ...(payload.description !== undefined && { description: payload.description.trim() }),
      ...(payload.spentAt !== undefined && { spentAt: new Date(payload.spentAt) }),
      ...(payload.vendor !== undefined && { vendor: payload.vendor?.trim() || null }),
      ...(payload.categoryId !== undefined && { categoryId: payload.categoryId }),
      ...(payload.productId !== undefined && { productId: payload.productId || null }),
    },
    include: INVESTMENT_INCLUDE,
  });
  return shape(row);
};

const deleteInvestment = async (id: string) => {
  await prisma.investment.delete({ where: { id } }).catch(() => {
    throw new ApiError(StatusCodes.NOT_FOUND, "Entry not found");
  });
  return { id };
};

/** Products offered in the "Linked SKU" dropdown. */
const listProductOptions = async () => {
  const rows = await prisma.product.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true, sku: true },
    orderBy: { name: "asc" },
  });
  return rows;
};

export const FinanceService = {
  seedDefaultCategories,
  getOverview,
  setRevenue,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listInvestments,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  listProductOptions,
};
