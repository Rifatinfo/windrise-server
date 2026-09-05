import { Request, Response } from "express"


import { PaymentService } from "./payment.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";

import { envVars } from "../../../config";
import { SSLService } from "../sslCommerz/sslCommerz.service";

const successPayment = catchAsync(async (req: Request, res: Response) => {
    // SSLCommerz may send the callback as a POST (body) or redirect as GET (query).
    // Merge both so we never lose gateway data such as val_id, card_type, etc.
    const payload = {
        ...(req.query as Record<string, string>),
        ...(req.body as Record<string, string>),
    };
    const result = await PaymentService.successPayment(payload);
    console.log("Payment result", result);
    //=============== Redirect user to frontend success page  =================//

    return res.redirect(
        `${envVars.SSL_SUCCESS_FRONTEND_URL}?transactionId=${payload.transactionId ?? payload.tran_id}&orderId=${result.orderId}&invoiceUrl=${result.invoiceUrl}&message=${result.message}&amount=${payload.amount}&status=success`
    );
});

const failPayment = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, string>;

    const result = await PaymentService.failPayment(query);

    return res.redirect(
        `${envVars.SSL_FAIL_FRONTEND_URL}?transactionId=${query.transactionId}&message=${result.message}&status=fail`
    );
});

const cancelPayment = catchAsync(async (req: Request, res: Response) => {
    // SSLCommerz posts the cancel callback, but can also send the shopper's
    // browser here as a plain GET. Merge both so either lands on the page.
    const query = {
        ...(req.query as Record<string, string>),
        ...(req.body as Record<string, string>),
    };

    const result = await PaymentService.cancelPayment(query);

    // The cancelled page needs the order to offer a retry and the amount to
    // show what was attempted, so both travel with the redirect.
    const params = new URLSearchParams({
        transactionId: query.transactionId ?? "",
        orderId: result.orderId ?? "",
        orderNo: result.orderNo ?? "",
        amount: String(result.amount ?? ""),
        message: result.message,
        status: "cancel",
    });

    return res.redirect(`${envVars.SSL_CANCEL_FRONTEND_URL}?${params.toString()}`);
});
const initPayment = catchAsync(async (req: Request & { user?: { id: string } }, res: Response) => {
    const { orderId } = req.params;
    const result = await PaymentService.initPayment(orderId as string);

    sendResponse(res, {
        statusCode: 201,
        success: true,
        message: "Payment initiated successfully",
        data: result,
    });
});

const validatePayment = catchAsync(
    async (req: Request, res: Response) => {
        
        await SSLService.validatePayment(req.body)
        sendResponse(res, {
            statusCode: 200,
            success: true,
            message: "Payment Validated Successfully",
            data: null,
        });
    }
);

export const PaymentController = {
    successPayment,
    failPayment,
    cancelPayment,
    initPayment,
    validatePayment,
}