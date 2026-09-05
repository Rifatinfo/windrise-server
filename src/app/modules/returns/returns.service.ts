import { StatusCodes } from "http-status-codes";
import { Prisma } from "@prisma/client";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { SettingsService } from "../settings/settings.service";
import { CreateReturnDTO, UpdateReturnDTO } from "./returns.interface";

type Tx = Prisma.TransactionClient;

/**
 * Recompute a product's rolled-up stock figures from its variants, matching
 * how the inventory module derives them, so a restock leaves the product in
 * the same shape a manual stock adjustment would.
 */
const syncProductStock = async (
  tx: Tx,
  productId: string,
  lowStockThreshold: number,
) => {
  const variants = await tx.variant.findMany({
    where: { productId },
    select: { quantity: true },
  });

  // Products without variants carry their count on the product itself, so
  // there is nothing to roll up — the item-level update already handled it.
  if (variants.length === 0) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { stockQuantity: true },
    });
    const total = product?.stockQuantity ?? 0;
    await tx.product.update({
      where: { id: productId },
      data: {
        stockStatus:
          total === 0
            ? "OUT_OF_STOCK"
            : total <= lowStockThreshold
              ? "LOW_STOCK"
              : "IN_STOCK",
      },
    });
    return;
  }

  const total = variants.reduce((sum, variant) => sum + variant.quantity, 0);

  await tx.product.update({
    where: { id: productId },
    data: {
      stockQuantity: total,
      stockStatus:
        total === 0
          ? "OUT_OF_STOCK"
          : variants.some((variant) => variant.quantity <= lowStockThreshold)
            ? "LOW_STOCK"
            : "IN_STOCK",
    },
  });
};

/**
 * Move an order's items in or out of stock.
 *
 * `direction: 1` puts them back — the goods physically returned. `direction:
 * -1` takes them out again, used when a return that had already been
 * restocked is rejected and the items go back out to the customer.
 *
 * Mirrors the decrement done when the order was placed: the matching variant
 * and the product's rolled-up quantity both move, and the product's stock
 * status is recomputed afterwards.
 */
const applyReturnStockMovement = async (
  tx: Tx,
  orderId: string,
  direction: 1 | -1,
) => {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      productId: true,
      variantId: true,
      quantity: true,
      color: true,
      size: true,
    },
  });

  if (items.length === 0) return 0;

  const lowStockThreshold = await SettingsService.getLowStockThreshold();
  let unitsMoved = 0;

  for (const item of items) {
    const delta = direction * item.quantity;

    if (item.variantId) {
      await tx.variant.update({
        where: { id: item.variantId },
        data: { quantity: { increment: delta } },
      });
    } else {
      // Older order rows kept no variant link, so fall back to matching on
      // the colour/size snapshot the item was bought with.
      await tx.variant.updateMany({
        where: {
          productId: item.productId,
          color: item.color,
          size: item.size,
        },
        data: { quantity: { increment: delta } },
      });
    }

    await tx.product.update({
      where: { id: item.productId },
      data: { stockQuantity: { increment: delta } },
    });

    unitsMoved += Math.abs(delta);
  }

  const productIds = [...new Set(items.map((item) => item.productId))];
  for (const productId of productIds) {
    await syncProductStock(tx, productId, lowStockThreshold);
  }

  return unitsMoved;
};

const createReturnService = async (payload: CreateReturnDTO) => {
  const order = await prisma.order.findUnique({ where: { id: payload.orderId } });
  if (!order) throw new ApiError(StatusCodes.NOT_FOUND, "Order not found");

  const existing = await prisma.orderReturn.findUnique({ where: { orderId: payload.orderId } });
  if (existing) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "A return already exists for this order");
  }

  // Recording a return means the goods are back in hand, so the items go
  // straight back into stock. `restockedAt` stamps it so no later update to
  // the return can double-count them.
  return prisma.$transaction(async (tx) => {
    const created = await tx.orderReturn.create({
      data: {
        orderId: payload.orderId,
        reason: payload.reason,
        note: payload.note,
        refundAmount: order.totalAmount,
        restockedAt: new Date(),
      },
      include: { order: { select: { orderNo: true, name: true, totalAmount: true } } },
    });

    await applyReturnStockMovement(tx, payload.orderId, 1);

    // Keep the order's After-Sales column in step with the return.
    await tx.order.update({
      where: { id: payload.orderId },
      data: { afterSalesStatus: "RETURN" },
    });

    return created;
  });
};

const getAllReturnsService = async (status?: string) => {
  return prisma.orderReturn.findMany({
    where: status ? { status: status as any } : undefined,
    orderBy: { createdAt: "desc" },
    include: { order: { select: { orderNo: true, name: true, totalAmount: true, createdAt: true } } },
  });
};

const updateReturnService = async (id: string, payload: UpdateReturnDTO) => {
  const existing = await prisma.orderReturn.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Return not found");

  const nextStatus = payload.status ?? existing.status;
  const wasRestocked = Boolean(existing.restockedAt);

  // A rejected return goes back out to the customer, so stock that was added
  // has to come off again. Any other outcome means we keep the goods.
  const shouldRestock = nextStatus !== "REJECTED" && !wasRestocked;
  const shouldReverse = nextStatus === "REJECTED" && wasRestocked;

  return prisma.$transaction(async (tx) => {
    if (shouldRestock) await applyReturnStockMovement(tx, existing.orderId, 1);
    if (shouldReverse) await applyReturnStockMovement(tx, existing.orderId, -1);

    return tx.orderReturn.update({
      where: { id },
      data: {
        ...(payload.status && { status: payload.status }),
        ...(payload.refundStatus && { refundStatus: payload.refundStatus }),
        ...(payload.refundAmount !== undefined && { refundAmount: payload.refundAmount }),
        ...(shouldRestock && { restockedAt: new Date() }),
        ...(shouldReverse && { restockedAt: null }),
      },
      include: { order: { select: { orderNo: true, name: true, totalAmount: true } } },
    });
  });
};

export const ReturnService = {
  createReturnService,
  getAllReturnsService,
  updateReturnService,
};
