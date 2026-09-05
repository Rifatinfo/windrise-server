/**
 * Product reviews.
 *
 * The rule that shapes everything here: a review may only be written by someone
 * who actually bought the product. Eligibility is proved against the order book
 * rather than an account, because most orders are placed as a guest — the phone
 * number is the identity every order carries.
 */

import { OrderStatus, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { optimizeAndSaveImage } from "../../utils/imageOptimizer";

/** Last ten digits, matching how the order and chatbot modules compare phones. */
export const normalizePhone = (value: string) => value.replace(/\D/g, "").slice(-10);

/**
 * Orders that never became a purchase cannot earn a review.
 *
 * A cancelled or failed checkout is not a customer, and letting one through
 * would make the gate meaningless: anyone could start an order, abandon it, and
 * still review.
 */
const PURCHASED_STATUSES: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSED,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
];

const MAX_IMAGES = 5;
const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * The order that entitles this phone number to review this product.
 *
 * Matching is on phone and product, not on the name. Names are typed freely —
 * "Md Rifat" today, "Md. Rifat Hossain" at checkout — so requiring them to
 * agree would lock out real buyers while stopping nobody, since anyone who
 * knows the number could type either. The phone is the part the order actually
 * proves.
 */
const findPurchase = async (productId: string, phone: string) => {
  const digits = normalizePhone(phone);
  if (digits.length < 10) return null;

  return prisma.order.findFirst({
    where: {
      orderStatus: { in: PURCHASED_STATUSES },
      phone: { endsWith: digits },
      items: { some: { productId } },
    },
    select: { id: true, orderNo: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
};

export type Eligibility = {
  eligible: boolean;
  /** Set when this phone has already reviewed — the form pre-fills to edit it. */
  alreadyReviewed: boolean;
  orderNo: string | null;
  existingReview: { rating: number; body: string; images: string[] } | null;
  reason: string | null;
};

export const checkEligibility = async (
  productId: string,
  phone: string,
): Promise<Eligibility> => {
  const product = await prisma.product.findFirst({
    where: { id: productId, isDeleted: false },
    select: { id: true },
  });
  if (!product) throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");

  const digits = normalizePhone(phone);
  if (digits.length < 10) {
    return {
      eligible: false,
      alreadyReviewed: false,
      orderNo: null,
      existingReview: null,
      reason: "Enter the phone number you used when ordering.",
    };
  }

  const [order, existing] = await Promise.all([
    findPurchase(productId, digits),
    prisma.productReview.findUnique({
      where: { productId_phone: { productId, phone: digits } },
      select: { rating: true, body: true, images: true },
    }),
  ]);

  if (!order) {
    return {
      eligible: false,
      alreadyReviewed: Boolean(existing),
      orderNo: null,
      existingReview: existing,
      reason:
        "We couldn't find an order for this product against that number. Reviews are open to customers who bought it.",
    };
  }

  return {
    eligible: true,
    alreadyReviewed: Boolean(existing),
    orderNo: order.orderNo,
    existingReview: existing,
    reason: null,
  };
};

export type SubmitInput = {
  productId: string;
  name: string;
  phone: string;
  rating: number;
  body: string;
  images?: string[];
};

export const submitReview = async (input: SubmitInput) => {
  const name = input.name.trim();
  const body = input.body.trim();
  const digits = normalizePhone(input.phone);

  if (!name) throw new ApiError(StatusCodes.BAD_REQUEST, "Your name is required.");
  if (!body) throw new ApiError(StatusCodes.BAD_REQUEST, "Please write your review.");
  if (digits.length < 10) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Enter a valid phone number.");
  }
  if (
    !Number.isInteger(input.rating) ||
    input.rating < MIN_RATING ||
    input.rating > MAX_RATING
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Choose a rating from 1 to 5 stars.");
  }

  // The gate. Re-checked here rather than trusting the eligibility call the
  // form made earlier: that one is a convenience for the UI, this one is the
  // rule.
  const order = await findPurchase(input.productId, digits);
  if (!order) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "We couldn't find an order for this product against that number. Only customers who bought it can leave a review.",
    );
  }

  const images = (input.images ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES);

  // A second submission from the same customer replaces the first, which is
  // what the unique index is for — one voice per buyer, and a rewrite rather
  // than a duplicate.
  const review = await prisma.productReview.upsert({
    where: { productId_phone: { productId: input.productId, phone: digits } },
    create: {
      productId: input.productId,
      orderId: order.id,
      name,
      phone: digits,
      rating: input.rating,
      body,
      images,
    },
    update: { name, rating: input.rating, body, images, orderId: order.id },
  });

  return shapeReview(review);
};

/**
 * Hides an identity the customer used as their name.
 *
 * Some people type their phone number or email address into the name field.
 * Publishing that verbatim on a public product page would expose a contact
 * detail they did not mean to share, so those two shapes are masked while an
 * ordinary name is left alone.
 */
export const maskDisplayName = (raw: string) => {
  const name = raw.trim();

  if (name.includes("@")) {
    const [local, domain] = name.split("@");
    const head = local.slice(0, 2);
    return `${head}${"*".repeat(Math.max(3, local.length - 2))}@${domain}`;
  }

  const digits = name.replace(/\D/g, "");
  // Mostly digits, and long enough to be a number rather than a nickname.
  if (digits.length >= 10 && digits.length / name.replace(/\s/g, "").length > 0.8) {
    return `${digits.slice(0, 2)}${"X".repeat(digits.length - 3)}${digits.slice(-1)}`;
  }

  return name;
};

type ReviewRow = Prisma.ProductReviewGetPayload<object>;

const shapeReview = (row: ReviewRow) => ({
  id: row.id,
  // The stored name is never returned raw — see maskDisplayName.
  name: maskDisplayName(row.name),
  rating: row.rating,
  body: row.body,
  images: row.images,
  createdAt: row.createdAt,
});

export type ReviewSummary = {
  average: number | null;
  total: number;
  /** Count per star, 5 down to 1, for the distribution bars. */
  distribution: { stars: number; count: number; percent: number }[];
};

export const listReviews = async (
  productId: string,
  options: { page?: number; limit?: number } = {},
) => {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(50, Math.max(1, options.limit ?? 3));

  const [rows, total, grouped, aggregate] = await Promise.all([
    prisma.productReview.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.productReview.count({ where: { productId } }),
    prisma.productReview.groupBy({
      by: ["rating"],
      where: { productId },
      _count: { _all: true },
    }),
    prisma.productReview.aggregate({
      where: { productId },
      _avg: { rating: true },
    }),
  ]);

  const counts = new Map(grouped.map((g) => [g.rating, g._count._all]));

  const summary: ReviewSummary = {
    // One decimal, as the page prints it ("4.1 out of 5"). Null with no
    // reviews rather than a zero, which would read as a bad score.
    average:
      aggregate._avg.rating === null
        ? null
        : Math.round(aggregate._avg.rating * 10) / 10,
    total,
    distribution: [5, 4, 3, 2, 1].map((stars) => {
      const count = counts.get(stars) ?? 0;
      return {
        stars,
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 100),
      };
    }),
  };

  return {
    summary,
    data: rows.map(shapeReview),
    meta: { page, limit, total },
  };
};

/** Stores a photo attached to a review. */
export const uploadReviewImage = async (file: Express.Multer.File) => {
  const filename = await optimizeAndSaveImage(file, "reviews");
  // Relative, like every other upload: the storefront serves /uploads through
  // its own rewrite, and an absolute URL to the API host trips helmet's
  // cross-origin resource policy.
  return { url: `/uploads/reviews/${filename}` };
};

export const ReviewService = {
  checkEligibility,
  submitReview,
  listReviews,
  uploadReviewImage,
  maskDisplayName,
  normalizePhone,
};
