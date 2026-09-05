import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import { OrderStatus, PaymentStatus } from "@prisma/client";

import ApiError from "../../errors/ApiError";

import { generateInvoice } from "@/app/utils/invoice";
import { saveInvoicePdf } from "@/app/utils/invoiceUrl";
import { buildOrderEmailHtml, sendEmail } from "@/app/utils/sendEmail";
import { ISSLCommerz } from "../sslCommerz/sslCommerz.interface";
import { SSLService } from "../sslCommerz/sslCommerz.service";

const WALLET_LABELS: Record<string, string> = {
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  DBBL: "Rocket",
  UPAY: "Upay",
  MCASH: "Mcash",
  UCASH: "uCash",
  OK: "OK Wallet",
  TAP: "Tap",
};

const CARD_BRAND_LABELS: Record<string, string> = {
  VISA: "Visa",
  MASTER: "Mastercard",
  MASTERCARD: "Mastercard",
  AMEX: "Amex",
  AMERICANEXPRESS: "Amex",
  AMERICAN_EXPRESS: "Amex",
};

type GatewayMatch = { kind: "wallet" | "card"; name: string };

const detectGateway = (value?: string): GatewayMatch | null => {
  if (!value) return null;
  const upper = value.toUpperCase();
  const code = upper.split("-")[0].trim();

  const wallet = WALLET_LABELS[code];
  if (wallet) return { kind: "wallet", name: wallet };

  const brand = CARD_BRAND_LABELS[code];
  if (brand) return { kind: "card", name: brand };

  for (const [key, name] of Object.entries(WALLET_LABELS)) {
    if (upper.includes(key) || upper.includes(name.toUpperCase())) {
      return { kind: "wallet", name };
    }
  }

  return null;
};

/**
 * Build a human-readable payment method label from SSLCommerz data.
 * Wallets -> "bKash", "Nagad", "Rocket". Cards -> "Visa....6652".
 */
const buildGatewayLabel = (data: Record<string, any>): string => {
  const cardType = data.card_type?.toString().trim();
  const cardIssuer = data.card_issuer?.toString().trim();
  const cardBrand = data.card_brand?.toString().trim();
  const cardNo = data.card_no?.toString().trim();

  const match =
    detectGateway(cardType) ??
    detectGateway(cardBrand) ??
    detectGateway(cardIssuer);

  if (match) {
    if (match.kind === "card" && cardNo) {
      const digits = cardNo.replace(/\D/g, "");
      const last4 = digits.length >= 4 ? digits.slice(-4) : null;
      if (last4) return `${match.name}....${last4}`;
    }
    return match.name;
  }

  return "SSLCommerz";
};

export const successPayment = async (payload: Record<string, string>) => {
  const transactionId = payload.transactionId ?? payload.tran_id;

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Transaction ID is required");
  }

  // ================= FIND PAYMENT ================= //
  const payment = await prisma.payment.findUnique({
    where: { transactionId },
    include: {
      order: {
        include: {
          items: true,
          user: true,
        },
      },
    },
  });

  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  const order = payment.order;

  // ================= ALREADY PAID (idempotency guard) ================= //
  if (payment.paymentStatus === PaymentStatus.PAID) {
    return {
      success: true,
      message: "Payment already processed",
      orderId: order.id,
      invoiceUrl: order.invoiceUrl,
    };
  }

  // ================= FETCH SSLCommerz GATEWAY DATA ================= //
  // If SSLCommerz sent a val_id, validate the transaction and capture the
  // real gateway / card / wallet details (bKash, Nagad, Visa, etc.).
  let gatewayUpdate: Record<string, any> = {};
  let gatewayLabel = "";
  if (payload.val_id) {
    try {
      const validationData = await SSLService.fetchValidationData(
        payload.val_id,
      );
      if (validationData && validationData.status === "VALID") {
        gatewayUpdate = SSLService.buildGatewayUpdateData(validationData);
        gatewayLabel = buildGatewayLabel(validationData);
      }
    } catch (err: any) {
      // Do not fail the order if validation fetch fails; log and continue.
      console.error(
        `[Payment ${payment.id}] Gateway validation fetch failed:`,
        err.message,
      );
    }
  }

  // Fallback to callback data when validation API is not reachable/available.
  if (!gatewayUpdate.cardType && (payload.card_type || payload.card_issuer)) {
    gatewayUpdate = {
      gatewayStatus: payload.status ?? gatewayUpdate.gatewayStatus ?? null,
      validationId: payload.val_id ?? gatewayUpdate.validationId ?? null,
      bankTranId: payload.bank_tran_id ?? gatewayUpdate.bankTranId ?? null,
      cardType: payload.card_type ?? gatewayUpdate.cardType ?? null,
      cardIssuer: payload.card_issuer ?? gatewayUpdate.cardIssuer ?? null,
      riskLevel: payload.risk_level ?? gatewayUpdate.riskLevel ?? null,
      riskTitle: payload.risk_title ?? gatewayUpdate.riskTitle ?? null,
      storeAmount: payload.store_amount ?? gatewayUpdate.storeAmount ?? null,
      currencyAmount:
        payload.currency_amount ?? gatewayUpdate.currencyAmount ?? null,
      paymentGatewayData: Object.keys(payload).length
        ? payload
        : (gatewayUpdate.paymentGatewayData ?? null),
    };
    if (!gatewayLabel) gatewayLabel = buildGatewayLabel(payload);
  }

  console.log("========== PAYMENT GATEWAY ==========");
  console.log("Transaction ID:", transactionId);
  console.log("Bank Transaction ID:", gatewayUpdate.bankTranId);
  console.log("Payment Method:", gatewayLabel);
  console.log("Card Type:", gatewayUpdate.cardType);
  console.log("Card Issuer:", gatewayUpdate.cardIssuer);
  console.log("Gateway Status:", gatewayUpdate.gatewayStatus);
  console.log("Validation ID:", gatewayUpdate.validationId);
  console.log("Full Gateway Data:", gatewayUpdate.paymentGatewayData);
  console.log("=====================================");
//========================================= =============================================// 
  console.log("gatewayUpdate", gatewayUpdate);
  console.log("payment", payment);
  console.log("order", order);
  // ================= MARK AS PAID + SAVE GATEWAY DATA ================= //
  await prisma.$transaction(async (tx) => {
    await Promise.all([
      tx.payment.update({
        where: { id: payment.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          paidAt: new Date(),
          paymentMethod: gatewayLabel || payment.paymentMethod || "SSLCommerz",
          ...gatewayUpdate,
        },
      }),
      tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: PaymentStatus.PAID,
          orderStatus: OrderStatus.CONFIRMED,
        },
      }),
    ]);
  });

  // ================= FIRE-AND-FORGET: PDF + EMAIL + INVOICE URL SAVE ================= //
  // Response is returned immediately — PDF generation runs in background
  setImmediate(async () => {
    try {
      // Use the order number generated when the order was created.
      const orderSerialId = order.orderNo;
      const displayPaymentMethod =
        gatewayLabel || "Online Payment (SSLCommerz)";

      const pdfBuffer = await generateInvoice({
        id: order.id,
        orderSerial: orderSerialId,
        checkoutEmail: order.checkoutEmail,
        name: order.name,
        phone: order.phone,
        address: order.address,
        state: order.state,
        paymentMethod: displayPaymentMethod,
        paymentStatus: "PAID",
        deliveryType: order.deliveryType,
        deliveryCharge: Number(order.deliveryCharge),
        subtotal: order.subtotal,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          productName: item.productName,
          price: item.price,
          quantity: item.quantity,
          total: item.total,
          color: item.color,
          size: item.size,
          sku: item.sku,
        })),
      });

      // Save PDF + update both records in parallel
      const [invoiceUrl] = await Promise.all([
        saveInvoicePdf(pdfBuffer, `invoice-${order.id}`),
        // DB updates and email kicked off after invoiceUrl is ready below
      ]);

      // FIX: check both registered user email AND guest checkoutEmail
      const emailToSend = order.user?.email ?? order.checkoutEmail ?? null;

      await Promise.all([
        // Save invoiceUrl to both payment and order in parallel
        prisma.payment.update({
          where: { id: payment.id },
          data: { invoiceUrl },
        }),
        prisma.order.update({
          where: { id: order.id },
          data: { invoiceUrl },
        }),
        // Send email (skipped silently if no address found)
        emailToSend
          ? sendEmail({
              to: emailToSend,
              subject: "Payment Successful — Your Order Invoice",
              html: buildOrderEmailHtml({
                ...order,
                paymentMethod: displayPaymentMethod,
                paymentStatus: "PAID",
              }),
              attachments: [
                {
                  filename: `invoice-${order.id}.pdf`,
                  content: pdfBuffer,
                  contentType: "application/pdf",
                },
              ],
            })
          : Promise.resolve(),
      ]);
    } catch (err) {
      // Order is already confirmed — log but never crash
      console.error(`[Payment ${payment.id}] Post-processing failed:`, err);
    }
  });

  // Return immediately — don't wait for PDF/email
  return {
    success: true,
    message: "Payment processed successfully",
    orderId: order.id,
    // invoiceUrl will be null here (generated in background) — frontend
    // should poll or use a webhook if it needs the URL immediately
    invoiceUrl: order.invoiceUrl ?? null,
  };
};

/**===============================================
 *=============== FAIL PAYMENT =================
 =================================================*/
const failPayment = async (query: Record<string, string>) => {
  const { transactionId } = query;

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Transaction ID missing");
  }

  const payment = await prisma.payment.findUnique({
    where: { transactionId },
  });

  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  //================ Prevent double update ================//
  if (payment.paymentStatus === PaymentStatus.PAID) {
    return { success: false, message: "Payment already completed" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        failedAt: new Date(),
      },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        orderStatus: OrderStatus.PLACED,
      },
    });
  });

  return { success: true, message: "Payment failed" };
};

/**===============================================
 *=============== CANCEL PAYMENT =================
 =================================================*/
const cancelPayment = async (query: Record<string, string>) => {
  const { transactionId } = query;

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Transaction ID missing");
  }

  const payment = await prisma.payment.findUnique({
    where: { transactionId },
    include: { order: { select: { orderNo: true } } },
  });

  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  // The cancelled page shows the attempted amount and offers a retry, so both
  // outcomes carry back the order details it needs. The amount comes from the
  // payment record rather than the gateway's query string.
  const details = {
    orderId: payment.orderId,
    orderNo: payment.order?.orderNo ?? null,
    amount: Number(payment.amount),
  };

  // Prevent double update
  if (payment.paymentStatus === PaymentStatus.PAID) {
    return { success: false, message: "Payment already completed", ...details };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        paymentStatus: PaymentStatus.CANCELED,
        cancelledAt: new Date(),
      },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: {
        paymentStatus: PaymentStatus.CANCELED,
        orderStatus: OrderStatus.PLACED,
      },
    });
  });

  return { success: true, message: "Payment cancelled", ...details };
};

const initPayment = async (orderId: string) => {
  //============= 1 Find the order ==================//
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true, user: true, items: true },
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  const payment = order.payment;

  if (!payment) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Payment record not found for this order",
    );
  }
  //=============== 3 Prepare SSLCommerz payload ==================//
  const sslPayload: ISSLCommerz = {
    name: order.name,
    email: (order.user as any)?.email || order.checkoutEmail,
    phone: order.phone,
    address: order.address,
    totalAmount: Number(payment.amount),
    transactionId: payment.transactionId,
  };

  //================ 4 Call SSLCommerz API ==================//
  const sslPayment = await SSLService.sslPaymentInit(sslPayload);

  //================ 5 Return payment URL ==================//
  return {
    paymentUrl: sslPayment.GatewayPageURL,
  };
};

export const PaymentService = {
  successPayment,
  failPayment,
  cancelPayment,
  initPayment,
};
