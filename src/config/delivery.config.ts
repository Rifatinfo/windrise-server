export const DELIVERY_CHARGE: Record<string, number> = {
  DHAKA_CITY: 60,
  OUTSIDE_DHAKA: 130,
  DHAKA_SUBURB: 100,
};

/**
 * Business days a delivery normally takes per zone — the upper bound of the
 * window quoted to the customer at checkout ("2-3", "3-4", "5-7 business
 * days"). Drives the estimated delivery date on the order-tracking page.
 */
export const DELIVERY_DAYS: Record<string, number> = {
  DHAKA_CITY: 3,
  DHAKA_SUBURB: 4,
  OUTSIDE_DHAKA: 7,
};

/** Fallback window when an order has no delivery type recorded. */
export const DEFAULT_DELIVERY_DAYS = 5;
