import { RefundStatus, ReturnReason, ReturnStatus } from "@prisma/client";

export interface CreateReturnDTO {
  orderId: string;
  reason: ReturnReason;
  note?: string;
}

export interface UpdateReturnDTO {
  status?: ReturnStatus;
  refundStatus?: RefundStatus;
  refundAmount?: number;
}
