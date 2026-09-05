import { AnalyticsEventType } from "@prisma/client";

import prisma from "../../../shared/prisma";

const trackEventService = async (payload: {
  type: AnalyticsEventType;
  sessionId: string;
  productId?: string;
  path?: string;
}) => {
  return prisma.analyticsEvent.create({
    data: {
      type: payload.type,
      sessionId: payload.sessionId,
      productId: payload.productId,
      path: payload.path,
    },
  });
};

export const AnalyticsService = { trackEventService };
