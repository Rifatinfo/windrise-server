import { OrderStatus, Prisma } from "@prisma/client";

// Orders in these statuses never happened commercially — excluded from revenue/units-sold math everywhere in `stats`.
export const VALID_ORDER_STATUS_FILTER: Prisma.EnumOrderStatusFilter = {
  notIn: [OrderStatus.CANCELED, OrderStatus.FAILED, OrderStatus.EXPIRED],
};

export const LOW_STOCK_THRESHOLD = 10;
