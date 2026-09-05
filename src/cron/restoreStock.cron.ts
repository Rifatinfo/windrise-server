import cron from "node-cron";
import prisma from "../shared/prisma";
import { OrderStatus, PaymentStatus } from "@prisma/client";


export const startRestoreStockCron = () => {
    console.log("🕒 Restore stock cron initialized");

    cron.schedule("*/30 * * * *", async () => {
        console.log("Running stock restore cron...");

        const expiredOrders = await prisma.order.findMany({
            where: {
                paymentMethod: "ONLINE",     //  exclude COD
                paymentStatus: {
                    in: [PaymentStatus.CANCELED, PaymentStatus.FAILED],
                },
                orderStatus: OrderStatus.PLACED,
                createdAt: {
                    lt: new Date(Date.now() - 30 * 60 * 1000), // 30 min
                },
            },
            include: {
                items: true,
            },
        });

        for (const order of expiredOrders) {
            try {
                await prisma.$transaction(async (tx) => {
                    for (const item of order.items) {

                        //================  1. Restore PRODUCT stock ================//
                        await tx.product.update({
                            where: { id: item.productId },
                            data: {
                                stockQuantity: { increment: item.quantity },
                            },
                        });

                        //================  2. Restore VARIANT stock ================//
                        if (item.variantId) {
                            await tx.variant.update({
                                where: { id: item.variantId },
                                data: {
                                    quantity: { increment: item.quantity },
                                },
                            });
                        }
                    }


                    // ================ 3. Mark order as EXPIRED =================//
                    await tx.order.update({
                        where: { id: order.id },
                        data: { orderStatus: OrderStatus.EXPIRED },
                    });
                });
            } catch (error) {
                console.error(`Failed to restore stock for order ${order.id}:`, error);
            }
        }
    });
};