import { Prisma } from "@prisma/client";

import prisma from "../../../shared/prisma";

const SINGLETON_ID = "singleton";

/**
 * Reads the single settings row, creating it with defaults on first use so
 * callers never have to handle a missing record.
 */
const getStoreSettings = async () => {
  const existing = await prisma.storeSettings.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (existing) return existing;

  return prisma.storeSettings.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
};

/**
 * The subset the storefront may read without authentication — shipping rates
 * and contact details. Deliberately excludes anything operational.
 */
const getPublicSettings = async () => {
  const s = await getStoreSettings();
  return {
    storeName: s.storeName,
    supportEmail: s.supportEmail,
    supportPhone: s.supportPhone,
    storeAddress: s.storeAddress,
    shipping: {
      DHAKA_CITY: s.shippingDhakaCity,
      DHAKA_SUBURB: s.shippingDhakaSuburb,
      OUTSIDE_DHAKA: s.shippingOutsideDhaka,
    },
    freeShippingThreshold: s.freeShippingThreshold,
  };
};

const updateStoreSettings = async (data: Prisma.StoreSettingsUpdateInput) => {
  await getStoreSettings(); // guarantees the row exists
  return prisma.storeSettings.update({ where: { id: SINGLETON_ID }, data });
};

/** Convenience for services that need the low-stock cutoff. */
const getLowStockThreshold = async () => (await getStoreSettings()).lowStockThreshold;

export const SettingsService = {
  getStoreSettings,
  getPublicSettings,
  updateStoreSettings,
  getLowStockThreshold,
};
