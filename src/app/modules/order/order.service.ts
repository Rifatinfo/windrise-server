import { StatusCodes } from "http-status-codes";
import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { CreateOrderDTO } from "./order.interface";

import {
  AfterSalesStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ShipmentStatus,
} from "@prisma/client";
import { orderSearchableFields } from "./order.constant";

import { generateInvoice } from "@/app/utils/invoice";
import { saveInvoicePdf } from "@/app/utils/invoiceUrl";
import { buildOrderEmailHtml, sendEmail } from "@/app/utils/sendEmail";
import {
  DEFAULT_DELIVERY_DAYS,
  DELIVERY_CHARGE,
  DELIVERY_DAYS,
} from "@/config/delivery.config";
import { parseDeliveryType } from "@/app/utils/parseDeliveryType";
import { SSLService } from "../sslCommerz/sslCommerz.service";
import { paginationHelper } from "@/app/helpers/paginationHelper";
import { CouponService } from "../coupon/coupon.service";


                       
export const getTransactionId = () => {
  return "TXN_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
};

export const generateOrderSerial = async (): Promise<string> => {
  let orderNo = '';
  let exists = true;
  let attempts = 0;
  const maxAttempts = 10;

  while (exists && attempts < maxAttempts) {
    orderNo = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await prisma.order.findUnique({ where: { orderNo } });
    exists = Boolean(existing);
    attempts++;
  }

  if (exists) {
    throw new Error('Unable to generate a unique order number');
  }

  return orderNo;
};

// =========================
// Shared helper: fire-and-forget PDF + Email
// Called after both COD order creation AND online payment confirmation
// =========================
export async function sendOrderConfirmationAsync({
  result,
  orderSerialId,
  paymentMethod,
  paymentStatus,
  userEmail,
  checkoutEmail,
}: {
  result: any;
  orderSerialId: string;
  paymentMethod: "COD" | "ONLINE";
  paymentStatus: string;
  userEmail?: string;
  checkoutEmail?: string;
}) {
  setImmediate(async () => {
    try {
      const pdfBuffer = await generateInvoice({
        id: result.id,
        orderSerial: orderSerialId,

        name: result.name,
        phone: result.phone,
        address: result.address,
        state: result.state,

        checkoutEmail: result.checkoutEmail,

        paymentMethod:
          paymentMethod === "COD" ? "Cash on Delivery" : "SSLCommerz",
        paymentStatus,

        subtotal: result.subtotal,
        totalAmount: result.totalAmount,

        deliveryType: result.deliveryType,
        deliveryCharge: result.deliveryCharge,

        createdAt: result.createdAt,

        items: result.items.map((item: any) => ({
          productName: item.productName,
          price: item.price,
          quantity: item.quantity,
          total: item.total,
          color: item.color,
          size: item.size,
          sku: item.sku,
        })),
      });

      const emailToSend = userEmail || checkoutEmail || result.checkoutEmail;

      // Save PDF + send email in parallel (one email only)
      const [invoiceUrl] = await Promise.all([
        saveInvoicePdf(pdfBuffer, `invoice-${result.id}`),
        emailToSend
          ? sendEmail({
              to: emailToSend,
              subject:
                paymentMethod === "COD"
                  ? "Your Order Invoice"
                  : "Payment Successful — Your Order Invoice",
              html: buildOrderEmailHtml({
                ...result,
                paymentMethod:
                  paymentMethod === "COD" ? "Cash on Delivery" : "SSLCommerz",
                paymentStatus,
              }),
              attachments: [
                {
                  filename: `invoice-${result.id}.pdf`,
                  content: pdfBuffer,
                  contentType: "application/pdf",
                },
              ],
            })
          : Promise.resolve(),
      ]);

      // Update invoiceUrl in DB (non-blocking, already outside transaction)
      await Promise.all([
        prisma.order.update({
          where: { id: result.id },
          data: { invoiceUrl },
        }),
        prisma.payment.update({
          where: { id: result.payment.id },
          data: { invoiceUrl },
        }),
      ]);

      result.invoiceUrl = invoiceUrl;
      result.payment.invoiceUrl = invoiceUrl;
    } catch (err) {
      // Log but don't crash — order is already confirmed
      console.error(`[Order ${result.id}] Post-processing failed:`, err);
    }
  });
}

const createOrderService = async ({
  payload,
  userId,
  userEmail,
}: {
  payload: CreateOrderDTO;
  userId?: string;
  userEmail?: string;
}) => {
  const {
    deliveryInfo,
    billingInfo,
    cartItems,
    paymentMethod,
    deliveryType,
    checkoutEmail,
  } = payload;

  // =========================
  // Basic Validation
  // =========================

  if (!cartItems || cartItems.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Cart is empty");
  }

  const deliveryCharge = DELIVERY_CHARGE[deliveryType];

  if (deliveryCharge === undefined) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid delivery option");
  }

  const orderSerialId = await generateOrderSerial();

  // =========================
  // PREPARE DATA OUTSIDE TRANSACTION
  // Batch fetch all products + variants in ONE round-trip (2 DB calls instead of 2*N)
  // =========================

  const productIds = cartItems.map((item) => item.productId);

  const [allProducts, allVariants] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { images: true },
    }),
    prisma.variant.findMany({
      where: { productId: { in: productIds } },
    }),
  ]);

  const productMap = new Map(allProducts.map((p) => [p.id, p]));

  // Validate and prepare order items (pure CPU work, no DB)
  let subtotal = 0;
  const preparedOrderItems = cartItems.map((item) => {
    const product = productMap.get(item.productId);

    if (!product) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");
    }

    const variant = allVariants.find(
      (v) =>
        v.productId === item.productId &&
        v.color === item.color &&
        v.size === item.size,
    );

    if (!variant) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Variant not found");
    }

    if (variant.quantity < item.quantity) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Insufficient stock for ${product.name} ${item.color} ${item.size}`,
      );
    }

    const price = product.salePrice ?? product.regularPrice;
    const total = price * item.quantity;
    subtotal += total;

    return {
      productId: product.id,
      productName: product.name,
      variantId: variant.id,
      price,
      quantity: item.quantity,
      total,
      color: item.color,
      size: item.size,
      sku: product.sku,
      productImage: product.images?.[0]?.url || null,
    };
  });

  // =========================
  // Coupon: re-validate server-side even if the client already checked
  // =========================
  let couponId: string | undefined;
  let discountAmount = 0;
  if (payload.couponCode) {
    const { coupon, discountAmount: discount } = await CouponService.validateCouponService({
      code: payload.couponCode,
      subtotal,
    });
    couponId = coupon.id;
    discountAmount = discount;
  }

  const totalAmount = Math.max(subtotal - discountAmount, 0) + deliveryCharge;

  // =========================
  // FAST TRANSACTION: only DB writes inside, no PDF/email
  // All stock decrements run in parallel
  // =========================

  const result = await prisma.$transaction(async (tx) => {
    // Create Order
    const order = await tx.order.create({
      data: {
        orderNo: orderSerialId,
        user: userId ? { connect: { id: userId } } : undefined,

        name: deliveryInfo.name,
        phone: deliveryInfo.phone,
        state: deliveryInfo.state,
        address: deliveryInfo.address,

        billingName: billingInfo?.name ?? null,
        billingPhone: billingInfo?.phone ?? null,
        billingEmail: billingInfo?.email ?? null,
        billingState: billingInfo?.state ?? null,
        billingAddress: billingInfo?.address ?? null,

        deliveryCharge,

        checkoutEmail: userEmail ?? checkoutEmail,

        deliveryType: parseDeliveryType(deliveryType),

        subtotal,
        totalAmount,

        coupon: couponId ? { connect: { id: couponId } } : undefined,
        discountAmount,

        paymentMethod:
          paymentMethod === "ONLINE" ? PaymentMethod.ONLINE : PaymentMethod.COD,

        orderStatus: "PLACED",
        paymentStatus: "UNPAID",

        items: {
          create: preparedOrderItems,
        },

        // First entry of the timeline the customer sees on /order-tracking.
        statusEvents: {
          create: { status: OrderStatus.PLACED },
        },
      },
      include: {
        items: true,
      },
    });

    if (couponId) {
      await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
    }

    const createdOrder = order as typeof order & { items: typeof preparedOrderItems };

    // Run ALL stock decrements in parallel
    await Promise.all(
      cartItems.flatMap((item) => [
        tx.variant.updateMany({
          where: {
            productId: item.productId,
            color: item.color,
            size: item.size,
          },
          data: { quantity: { decrement: item.quantity } },
        }),
        tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { decrement: item.quantity } },
        }),
      ]),
    );

    // Create Payment record
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        orderNo: orderSerialId,
        transactionId: getTransactionId(),
        paymentStatus: PaymentStatus.UNPAID,
        amount: totalAmount,
        currency: "BDT",
        paymentMethod: paymentMethod === "ONLINE" ? "SSLCommerz" : "COD",
        invoiceUrl: null,
      },
    });

    return {
      ...createdOrder,
      payment,
      deliveryType,
      deliveryCharge,
      items: createdOrder.items,
    };
  });

  // =========================
  // AFTER TRANSACTION — fire-and-forget (never blocks the response)
  // COD: send confirmation email immediately
  // ONLINE: email is sent from your payment callback/IPN after payment succeeds
  // =========================

  if (paymentMethod === "COD") {
    sendOrderConfirmationAsync({
      result,
      orderSerialId,
      paymentMethod: "COD",
      paymentStatus: "UNPAID",
      userEmail,
      checkoutEmail,
    });

    return {
      order: result,
      deliveryCharge: result.deliveryCharge,
    };
  }

  // ================== Online Payment ==================
  // NOTE: Call sendOrderConfirmationAsync() from your SSLCommerz IPN/callback
  // handler once payment is confirmed, passing paymentMethod: "ONLINE" and
  // paymentStatus: "PAID". Do NOT send email here — payment isn't confirmed yet.

  if (paymentMethod === "ONLINE" && result.payment) {
    const sslPayload = {
      transactionId: result.payment.transactionId,
      totalAmount: Number(result.payment.amount),
      name: result.name,
      email: userEmail ?? result.checkoutEmail ?? "",
      phone: result.phone,
      address: result.address,
    };
    const sslResponse = await SSLService.sslPaymentInit(sslPayload);
    return { order: result, paymentUrl: sslResponse.GatewayPageURL };
  }

  return {
    order: result,
    deliveryCharge: result.deliveryCharge,
  };
};




const getAllOrdersService = async (params: any, options: any) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelper.calculatePagination(options);
  const { searchTerm, startDate, endDate, ...filterData } = params;
  const andConditions: Prisma.OrderWhereInput[] = [];
  // ============ Search  =============//
  if (searchTerm) {
    andConditions.push({
      OR: orderSearchableFields.map((field) => ({
        [field]: {
          contains: searchTerm,
          mode: "insensitive",
        },
      })),
    });
  }

  // ============ Date range (createdAt) ============//
  if (startDate || endDate) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (startDate) {
      const start = new Date(startDate as string);
      if (!Number.isNaN(start.getTime())) createdAt.gte = start;
    }
    if (endDate) {
      const end = new Date(endDate as string);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
    }
    if (createdAt.gte || createdAt.lte) {
      andConditions.push({ createdAt });
    }
  }

  //=================== Filters  =================//
  if (Object.keys(filterData).length > 0) {
    andConditions.push({
      AND: Object.keys(filterData).map((key) => ({
        [key]: {
          equals: (filterData as any)[key],
        },
      })),
    });
  }

  const whereCondition: Prisma.OrderWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const orders = await prisma.order.findMany({
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
    where: whereCondition,
    include: {
      items: true,
      payment: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
  const total = await prisma.order.count({ where: whereCondition });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: orders,
  };
};

const updateOrderStatusService = async (
  orderId: string,
  status: OrderStatus,
) => {
  return prisma.order.update({
    where: { id: orderId },
    // Moving the order along the pipeline re-syncs both columns: clearing the
    // overrides lets them derive from the new order status again.
    data: {
      orderStatus: status,
      shipmentStatus: null,
      afterSalesStatus: null,
      // Stamps the transition so the customer tracking timeline can show the
      // date this step actually happened.
      statusEvents: { create: { status } },
    },
    include: { items: true, payment: true },
  });
};

/** Admin override for the Shipment column. */
const updateOrderShipmentStatusService = async (
  orderId: string,
  shipmentStatus: ShipmentStatus,
) => {
  return prisma.order.update({
    where: { id: orderId },
    data: { shipmentStatus },
    include: { items: true, payment: true },
  });
};

/** Admin override for the After-Sales column. */
const updateOrderAfterSalesStatusService = async (
  orderId: string,
  afterSalesStatus: AfterSalesStatus,
) => {
  return prisma.order.update({
    where: { id: orderId },
    data: { afterSalesStatus },
    include: { items: true, payment: true },
  });
};

const getOrderTrackingService = async (orderId: string, userId: string) => {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      userId, //  user can see only own order
    },

  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  return {
    orderStatus: order.orderStatus,
    createdAt: order.createdAt,
  };
};

const getMyOrdersService = async (userId: string, options: any) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelper.calculatePagination(options);

  const orders = await prisma.order.findMany({
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
    where: {
      userId,
    },
    include: {
      items: true,
      payment: true,
    },
  });

  const total = await prisma.order.count({ where: { userId } });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: orders,
  };
};

const updateOrderPaymentStatusService = async (
  orderId: string,
  paymentStatus: PaymentStatus,
) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });

  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Order not found");
  }

  const now = new Date();
  const paymentData: any = { paymentStatus };
  if (paymentStatus === PaymentStatus.PAID) paymentData.paidAt = now;
  if (paymentStatus === PaymentStatus.FAILED) paymentData.failedAt = now;
  if (paymentStatus === PaymentStatus.CANCELED) paymentData.cancelledAt = now;

  const [updatedOrder] = await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus,
        // Auto-confirm COD orders when payment is collected
        ...(paymentStatus === PaymentStatus.PAID &&
          order.paymentMethod === "COD" && {
            orderStatus: OrderStatus.CONFIRMED,
          }),
      },
      include: { items: true, payment: true },
    }),
    prisma.payment.update({
      where: { id: order.payment!.id },
      data: paymentData,
    }),
  ]);

  return updatedOrder;
};

const updateOrderInfoService = async (
  orderId: string,
  payload: any,
) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payment: true },
  });

  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Order not found");
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      name: payload.name,
      phone: payload.phone,
      state: payload.state,
      address: payload.address,
      orderNote: payload.orderNote,
      billingName: payload.billingName,
      billingPhone: payload.billingPhone,
      billingEmail: payload.billingEmail,
      billingState: payload.billingState,
      billingAddress: payload.billingAddress,
    },
    include: { items: true, payment: true },
  });

  return updatedOrder;
};

const getOrderByTransactionIdService = async (transactionId: string) => {
  const payment = await prisma.payment.findUnique({
    where: { transactionId },
    include: {
      order: {
        include: {
          items: {
            include: {
              product: {
                select: {
                  thumbnailImage: true,
                  salePrice: true,
                  regularPrice: true,
                },
              },
              variant: {
                select: {
                  color: true,
                  size: true,
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!payment || !payment.order) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Order not found");
  }

  const order = payment.order;

  return {
    id: order.id,
    orderNo: order.orderNo,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    name: order.name,
    phone: order.phone,
    state: order.state,
    address: order.address,
    orderNote: order.orderNote ?? null,
    checkoutEmail: order.checkoutEmail ?? null,
    billingName: order.billingName ?? null,
    billingPhone: order.billingPhone ?? null,
    billingEmail: order.billingEmail ?? null,
    billingState: order.billingState ?? null,
    billingAddress: order.billingAddress ?? null,
    subtotal: order.subtotal,
    totalAmount: order.totalAmount,
    deliveryCharge: order.deliveryCharge ? Number(order.deliveryCharge) : 0,
    deliveryType: order.deliveryType ?? null,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    invoiceUrl: order.invoiceUrl ?? null,
    user: order.user
      ? { id: order.user.id, email: order.user.email }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      price: item.price,
      quantity: item.quantity,
      total: item.total,
      color: item.color ?? null,
      size: item.size ?? null,
      sku: item.sku ?? null,
      variantId: item.variantId ?? null,
      productImage:
        item.productImage ?? item.product?.thumbnailImage ?? null,
    })),
    payment: {
      id: payment.id,
      orderId: payment.orderId,
      orderNo: payment.orderNo,
      transactionId: payment.transactionId,
      paymentStatus: payment.paymentStatus,
      paymentMethod: payment.paymentMethod,
      gatewayStatus: payment.gatewayStatus,
      bankTranId: payment.bankTranId,
      cardType: payment.cardType,
      cardIssuer: payment.cardIssuer,
      riskLevel: payment.riskLevel,
      riskTitle: payment.riskTitle,
      validationId: payment.validationId,
      storeAmount: payment.storeAmount ? Number(payment.storeAmount) : null,
      currencyAmount: payment.currencyAmount ? Number(payment.currencyAmount) : null,
      paymentGatewayData: payment.paymentGatewayData,
      amount: payment.amount,
      paidAt: payment.paidAt?.toISOString() ?? null,
      invoiceUrl: payment.invoiceUrl ?? null,
    },
  };
};

const getOrderByIdService = async (orderId: string) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      // ── Order items with product thumbnail + variant details ──────────────
      items: {
        include: {
          product: {
            select: {
              thumbnailImage: true,   // Product.thumbnailImage
              salePrice: true,
              regularPrice: true,
            },
          },
          variant: {                  // Variant (color / size / sku)
            select: {
              color: true,
              size: true,
            },
          },
        },
      },
      // ── Payment details including gateway/card info ───────────────────────
      payment: true,
      // ── Authenticated user (optional — guest orders have no user) ─────────
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });
 
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Order not found");
  }
 
  // ── Shape response to exactly match your schema field names ───────────────
  return {
    id:             order.id,
    orderNo:        order.orderNo,
    createdAt:      order.createdAt.toISOString(),
    updatedAt:      order.updatedAt.toISOString(),
 
    // Delivery / contact info (stored flat on Order)
    name:           order.name,
    phone:          order.phone,
    state:          order.state,
    address:        order.address,
    orderNote:      order.orderNote   ?? null,
    checkoutEmail:  order.checkoutEmail ?? null,

    // Billing info
    billingName:    order.billingName   ?? null,
    billingPhone:   order.billingPhone  ?? null,
    billingEmail:   order.billingEmail  ?? null,
    billingState:   order.billingState  ?? null,
    billingAddress: order.billingAddress ?? null,
 
    // Financials
    subtotal:       order.subtotal,
    totalAmount:    order.totalAmount,
    deliveryCharge: order.deliveryCharge ? Number(order.deliveryCharge) : 0,
    deliveryType:   order.deliveryType  ?? null,   // "inside_dhaka" | "outside_dhaka"
 
    // Status
    orderStatus:    order.orderStatus,    // PENDING | PROCESSING | …
    // null on both means "follow orderStatus" — the client derives the label.
    shipmentStatus:   order.shipmentStatus   ?? null,
    afterSalesStatus: order.afterSalesStatus ?? null,
    paymentStatus:  order.paymentStatus,  // UNPAID | PAID | …
    paymentMethod:  order.paymentMethod,  // ONLINE | COD
    invoiceUrl:     order.invoiceUrl ?? null,
 
    // User (null for guests)
    user: order.user
      ? { id: order.user.id, email: order.user.email }
      : null,
 
    // Order items — use the stored snapshot fields (productName, price, total)
    // so the receipt is always accurate even if the product changes later.
    items: order.items.map((item) => ({
      id:           item.id,
      productId:    item.productId,
      productName:  item.productName,           // snapshot field on OrderItem
      price:        item.price,                 // snapshot
      quantity:     item.quantity,
      total:        item.total,                 // snapshot
      color:        item.color  ?? null,
      size:         item.size   ?? null,
      sku:          item.sku    ?? null,
      variantId:    item.variantId ?? null,
      productImage: item.productImage           // snapshot image URL
                    ?? item.product?.thumbnailImage
                    ?? null,
    })),
 
    // Payment details
    payment: order.payment
      ? {
          id: order.payment.id,
          orderId: order.payment.orderId,
          orderNo: order.payment.orderNo,
          transactionId: order.payment.transactionId,
          paymentStatus: order.payment.paymentStatus,
          paymentMethod: order.payment.paymentMethod,
          gatewayStatus: order.payment.gatewayStatus,
          bankTranId: order.payment.bankTranId,
          cardType: order.payment.cardType,
          cardIssuer: order.payment.cardIssuer,
          riskLevel: order.payment.riskLevel,
          riskTitle: order.payment.riskTitle,
          validationId: order.payment.validationId,
          storeAmount: order.payment.storeAmount ? Number(order.payment.storeAmount) : null,
          currencyAmount: order.payment.currencyAmount ? Number(order.payment.currencyAmount) : null,
          paymentGatewayData: order.payment.paymentGatewayData,
          amount: order.payment.amount,
          paidAt: order.payment.paidAt?.toISOString() ?? null,
          invoiceUrl: order.payment.invoiceUrl ?? null,
        }
      : null,
  };
};


// ============================ Public order tracking ==========================

/** Digits only, last 10 — so "01712345678", "+8801712345678" and
 *  "8801712345678" all compare equal. */
const normalizePhone = (value: string) => value.replace(/\D/g, "").slice(-10);

/**
 * Bangladesh's weekend is Friday–Saturday, so those days don't count toward
 * the delivery window quoted at checkout.
 */
const addBusinessDays = (from: Date, days: number) => {
  const date = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 5 = Friday, 6 = Saturday
    if (day !== 5 && day !== 6) remaining -= 1;
  }
  return date;
};

type TrackedOrderRow = Prisma.OrderGetPayload<{
  include: { statusEvents: true; items: true };
}>;

/**
 * Real dates for the timeline. Orders created before the status log existed
 * have no rows, so their first and current steps fall back to the order's own
 * `createdAt` / `updatedAt` — both real timestamps, never invented ones.
 * Steps in between simply carry no date.
 */
const buildStatusHistory = (order: TrackedOrderRow) => {
  const history = order.statusEvents.map((event) => ({
    status: event.status,
    at: event.createdAt.toISOString(),
  }));

  const recorded = new Set(history.map((event) => event.status));

  if (!recorded.has(OrderStatus.PLACED)) {
    history.push({
      status: OrderStatus.PLACED,
      at: order.createdAt.toISOString(),
    });
  }

  if (
    order.orderStatus !== OrderStatus.PLACED &&
    !recorded.has(order.orderStatus)
  ) {
    history.push({
      status: order.orderStatus,
      at: order.updatedAt.toISOString(),
    });
  }

  return history.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
};

/**
 * Customer-facing order lookup — no authentication, so the order number and
 * the phone number on the order must BOTH match. A miss on either returns the
 * same 404, which stops the endpoint from being used to probe whether a given
 * order number exists.
 *
 * The response is deliberately narrow: delivery address, email, billing
 * details and payment/gateway records are all withheld. Only what the tracking
 * page renders is returned.
 */
const trackOrderService = async (rawOrderNo: string, rawPhone: string) => {
  const orderNo = rawOrderNo.trim().replace(/^#+/, "");
  const phone = normalizePhone(rawPhone);

  const notFound = new ApiError(
    StatusCodes.NOT_FOUND,
    "We couldn't find an order with that Order ID and phone number. Please check both and try again.",
  );

  if (!orderNo || !phone) throw notFound;

  const order = await prisma.order.findFirst({
    where: { OR: [{ orderNo }, { id: orderNo }] },
    include: { statusEvents: true, items: true },
  });

  if (!order || normalizePhone(order.phone) !== phone) throw notFound;

  const history = buildStatusHistory(order);
  const deliveredEvent = history.find(
    (event) => event.status === OrderStatus.DELIVERED,
  );

  const deliveryDays =
    (order.deliveryType && DELIVERY_DAYS[order.deliveryType]) ??
    DEFAULT_DELIVERY_DAYS;

  return {
    orderNo: order.orderNo,
    placedAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),

    orderStatus: order.orderStatus,
    shipmentStatus: order.shipmentStatus ?? null,
    afterSalesStatus: order.afterSalesStatus ?? null,

    /** Recorded transitions, oldest first. */
    history,

    /** Actual delivery date once delivered, otherwise null. */
    deliveredAt: deliveredEvent?.at ?? null,
    estimatedDeliveryAt: addBusinessDays(
      order.createdAt,
      deliveryDays,
    ).toISOString(),

    subtotal: order.subtotal,
    deliveryCharge: order.deliveryCharge ? Number(order.deliveryCharge) : 0,
    discountAmount: order.discountAmount,
    totalAmount: order.totalAmount,

    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku ?? null,
      size: item.size ?? null,
      color: item.color ?? null,
      quantity: item.quantity,
      price: item.price,
      total: item.total,
      productImage: item.productImage ?? null,
    })),
  };
};

export const orderService = {
  createOrderService,
  trackOrderService,
  getAllOrdersService,
  getMyOrdersService,
  updateOrderStatusService,
  updateOrderShipmentStatusService,
  updateOrderAfterSalesStatusService,
  updateOrderPaymentStatusService,
  updateOrderInfoService,
  getOrderTrackingService,
  getOrderByIdService,
  getOrderByTransactionIdService,
};