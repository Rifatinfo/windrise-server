import { StatusCodes } from "http-status-codes";
import { Coupon } from "@prisma/client";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { CreateCouponDTO, UpdateCouponDTO, ValidateCouponDTO } from "./coupon.interface";

const round2 = (value: number) => Math.round(value * 100) / 100;

const computeDiscount = (coupon: Coupon, subtotal: number) => {
  let discount =
    coupon.type === "PERCENTAGE" ? (subtotal * coupon.value) / 100 : coupon.value;

  if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.min(discount, subtotal);

  return round2(Math.max(discount, 0));
};

const createCouponService = async (payload: CreateCouponDTO) => {
  return prisma.coupon.create({
    data: {
      code: payload.code.trim().toUpperCase(),
      type: payload.type,
      value: payload.value,
      minOrderAmount: payload.minOrderAmount,
      maxDiscount: payload.maxDiscount,
      usageLimit: payload.usageLimit,
      isActive: payload.isActive ?? true,
      startDate: payload.startDate ? new Date(payload.startDate) : undefined,
      endDate: payload.endDate ? new Date(payload.endDate) : undefined,
    },
  });
};

const getAllCouponsService = async () => {
  return prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { orders: true } } },
  });
};

const updateCouponService = async (id: string, payload: UpdateCouponDTO) => {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(StatusCodes.NOT_FOUND, "Coupon not found");

  return prisma.coupon.update({
    where: { id },
    data: {
      ...(payload.code && { code: payload.code.trim().toUpperCase() }),
      ...(payload.type && { type: payload.type }),
      ...(payload.value !== undefined && { value: payload.value }),
      ...(payload.minOrderAmount !== undefined && { minOrderAmount: payload.minOrderAmount }),
      ...(payload.maxDiscount !== undefined && { maxDiscount: payload.maxDiscount }),
      ...(payload.usageLimit !== undefined && { usageLimit: payload.usageLimit }),
      ...(payload.isActive !== undefined && { isActive: payload.isActive }),
      ...(payload.startDate !== undefined && {
        startDate: payload.startDate ? new Date(payload.startDate) : null,
      }),
      ...(payload.endDate !== undefined && {
        endDate: payload.endDate ? new Date(payload.endDate) : null,
      }),
    },
  });
};

const deactivateCouponService = async (id: string) => {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(StatusCodes.NOT_FOUND, "Coupon not found");

  return prisma.coupon.update({ where: { id }, data: { isActive: false } });
};

const validateCouponService = async ({ code, subtotal }: ValidateCouponDTO) => {
  const coupon = await prisma.coupon.findUnique({
    where: { code: code.trim().toUpperCase() },
  });

  if (!coupon) throw new ApiError(StatusCodes.NOT_FOUND, "Coupon not found");
  if (!coupon.isActive) throw new ApiError(StatusCodes.BAD_REQUEST, "Coupon is not active");

  const now = new Date();
  if (coupon.startDate && now < coupon.startDate) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Coupon is not active yet");
  }
  if (coupon.endDate && now > coupon.endDate) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Coupon has expired");
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Coupon usage limit reached");
  }
  if (coupon.minOrderAmount != null && subtotal < coupon.minOrderAmount) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Minimum order amount for this coupon is ${coupon.minOrderAmount}`,
    );
  }

  const discountAmount = computeDiscount(coupon, subtotal);

  return { coupon, discountAmount };
};

export const CouponService = {
  createCouponService,
  getAllCouponsService,
  updateCouponService,
  deactivateCouponService,
  validateCouponService,
  computeDiscount,
};
