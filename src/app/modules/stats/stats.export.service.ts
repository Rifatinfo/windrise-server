import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { PassThrough } from "stream";
import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { VALID_ORDER_STATUS_FILTER } from "./stats.constant";
import { getBestCustomers, getTopProducts } from "./stats.service";

export type ExportType = "sales" | "orders" | "customers" | "products" | "payments" | "refunds";
export type ExportFormat = "csv" | "xlsx" | "pdf";

type Row = Record<string, string | number>;

const EXPORT_LABELS: Record<ExportType, string> = {
  sales: "Sales Report",
  orders: "Order Report",
  customers: "Customer Report",
  products: "Product Report",
  payments: "Payment Report",
  refunds: "Refund Report",
};

const getExportRows = async (type: ExportType, start: Date, end: Date): Promise<Row[]> => {
  switch (type) {
    case "sales": {
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: start, lte: end }, orderStatus: VALID_ORDER_STATUS_FILTER },
        orderBy: { createdAt: "desc" },
        select: {
          orderNo: true,
          createdAt: true,
          name: true,
          subtotal: true,
          discountAmount: true,
          totalAmount: true,
          paymentMethod: true,
        },
      });
      return orders.map((o) => ({
        "Order No": o.orderNo,
        Date: o.createdAt.toISOString().slice(0, 10),
        Customer: o.name,
        Subtotal: o.subtotal,
        Discount: o.discountAmount,
        Total: o.totalAmount,
        "Payment Method": o.paymentMethod,
      }));
    }
    case "orders": {
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: "desc" },
        select: {
          orderNo: true,
          createdAt: true,
          name: true,
          phone: true,
          orderStatus: true,
          paymentStatus: true,
          totalAmount: true,
        },
      });
      return orders.map((o) => ({
        "Order No": o.orderNo,
        Date: o.createdAt.toISOString().slice(0, 10),
        Customer: o.name,
        Phone: o.phone,
        Status: o.orderStatus,
        "Payment Status": o.paymentStatus,
        Total: o.totalAmount,
      }));
    }
    case "customers": {
      const customers = await getBestCustomers(1000);
      return customers.map((c) => ({
        Name: c.name,
        Email: c.email ?? "",
        "Total Orders": c.totalOrders,
        "Total Spent": c.totalSpent,
        "Avg Order Value": c.avgOrderValue,
        "Last Order": c.lastOrderDate ? c.lastOrderDate.toISOString().slice(0, 10) : "",
      }));
    }
    case "products": {
      const products = await getTopProducts(start, end, 1000);
      return products.map((p) => ({
        Product: p.name,
        "Units Sold": p.unitsSold,
        Revenue: p.revenue,
        "Current Stock": p.currentStock,
        Status: p.status,
      }));
    }
    case "payments": {
      const payments = await prisma.payment.findMany({
        where: { order: { createdAt: { gte: start, lte: end } } },
        orderBy: { createdAt: "desc" },
        select: {
          orderNo: true,
          transactionId: true,
          paymentMethod: true,
          paymentStatus: true,
          amount: true,
          paidAt: true,
        },
      });
      return payments.map((p) => ({
        "Order No": p.orderNo,
        "Transaction ID": p.transactionId,
        Method: p.paymentMethod ?? "",
        Status: p.paymentStatus,
        Amount: Number(p.amount),
        "Paid At": p.paidAt ? p.paidAt.toISOString().slice(0, 10) : "",
      }));
    }
    case "refunds": {
      const returns = await prisma.orderReturn.findMany({
        where: { createdAt: { gte: start, lte: end } },
        orderBy: { createdAt: "desc" },
        include: { order: { select: { orderNo: true, name: true } } },
      });
      return returns.map((r) => ({
        "Order No": r.order.orderNo,
        Customer: r.order.name,
        Reason: r.reason,
        Status: r.status,
        "Refund Status": r.refundStatus,
        "Refund Amount": r.refundAmount ?? 0,
        Date: r.createdAt.toISOString().slice(0, 10),
      }));
    }
    default:
      throw new ApiError(StatusCodes.BAD_REQUEST, "Unknown export type");
  }
};

const toCsv = (rows: Row[]): string => {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))];
  return lines.join("\n");
};

const toXlsx = async (rows: Row[], sheetName: string): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  if (rows.length > 0) {
    sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 20 }));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

const toPdf = (title: string, rows: Row[]): Promise<Buffer> => {
  const doc = new PDFDocument({ size: "A4", margin: 40, layout: "landscape" });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];

  stream.on("data", (c) => chunks.push(c));
  const endPromise = new Promise<Buffer>((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  doc.pipe(stream);

  doc.fontSize(16).text(title, { align: "left" });
  doc.fontSize(9).fillColor("#6B7280").text(`Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  doc.moveDown();

  if (rows.length === 0) {
    doc.fontSize(11).fillColor("#111111").text("No data for the selected range.");
  } else {
    const headers = Object.keys(rows[0]);
    const colWidth = (doc.page.width - 80) / headers.length;
    const startX = 40;
    let y = doc.y;

    doc.fontSize(9).fillColor("#111111");
    headers.forEach((h, i) => doc.text(h, startX + i * colWidth, y, { width: colWidth, ellipsis: true }));
    y += 16;
    doc.moveTo(startX, y).lineTo(doc.page.width - 40, y).strokeColor("#E5E7EB").stroke();
    y += 6;

    for (const row of rows) {
      if (y > doc.page.height - 60) {
        doc.addPage({ size: "A4", margin: 40, layout: "landscape" });
        y = 40;
      }
      headers.forEach((h, i) =>
        doc.text(String(row[h] ?? ""), startX + i * colWidth, y, { width: colWidth, ellipsis: true }),
      );
      y += 16;
    }
  }

  doc.end();
  return endPromise;
};

export const exportReport = async (type: ExportType, format: ExportFormat, start: Date, end: Date) => {
  const rows = await getExportRows(type, start, end);
  const label = EXPORT_LABELS[type];
  const filenameBase = `${type}-report-${start.toISOString().slice(0, 10)}_to_${end.toISOString().slice(0, 10)}`;

  if (format === "csv") {
    return { buffer: Buffer.from(toCsv(rows), "utf-8"), contentType: "text/csv", filename: `${filenameBase}.csv` };
  }
  if (format === "xlsx") {
    return {
      buffer: await toXlsx(rows, label),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${filenameBase}.xlsx`,
    };
  }
  if (format === "pdf") {
    return { buffer: await toPdf(label, rows), contentType: "application/pdf", filename: `${filenameBase}.pdf` };
  }

  throw new ApiError(StatusCodes.BAD_REQUEST, "Unsupported export format");
};
