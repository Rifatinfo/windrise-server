import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

export type OrderWithItems = {
  id: string;
  orderSerial: string;
  name: string;
  phone: string;
  address: string;
  state: string;
  checkoutEmail?: string | null;
  paymentMethod: string;
  paymentStatus: string;
  deliveryCharge: number;
  deliveryType: string;
  subtotal: number;
  totalAmount: number;
  createdAt: Date;
  items: {
    productName: string;
    price: number;
    quantity: number;
    total: number;
    color?: string | null;
    size?: string | null;
    sku?: string | null;
  }[];
};

export const generateInvoice = async (order: any) => {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  const stream = new PassThrough();
  const chunks: Buffer[] = [];

  stream.on("data", (c) => chunks.push(c));

  const endPromise = new Promise<Buffer>((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  doc.pipe(stream);

  const colors = {
    black: "#111111",
    gray: "#6B7280",
    light: "#E5E7EB",
  };

  /* ================= HEADER ================= */
  const logo = path.join(process.cwd(), "src/assets/Logo_Black.png");

  if (fs.existsSync(logo)) {
    doc.image(logo, 50, 45, { width: 90 });
  }

  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor(colors.gray)
    .text("INVOICE", 470, 50);

  /* ================= META BOX ================= */
  doc
    .fontSize(9)
    .fillColor(colors.gray)
    .text("DATE :", 420, 85)
    .text("ORDER NUMBER :", 420, 100);

  doc
    .fontSize(9)
    .fillColor(colors.black)
    .text(order.createdAt.toDateString(), 470, 85, { align: "right" })
    .text(order.orderSerial, 515, 100, { align: "right" });

  /* ================= BILL TO ================= */
  doc.fontSize(10).font("Helvetica-Bold").text("BILLED TO:", 50, 130);

  doc
    .font("Helvetica")
    .fontSize(9)
    .text(order.name, 50, 150)
    .text(order.address, 50, 165, { width: 250 })
    .text(order.state, 50, 210)
    .text(order.phone, 50, 225);

  /* ================= TABLE HEADER ================= */
  const tableTop = 280;

  doc.roundedRect(50, tableTop, 500, 25, 6).fill("#111111");

  doc
    .fillColor("white")
    .fontSize(9)
    .text("DESCRIPTION", 60, tableTop + 7)
    .text("QUANTITY", 300, tableTop + 7)
    .text("PRICE", 380, tableTop + 7)
    .text("TOTAL", 460, tableTop + 7);

  /* ================= ITEMS ================= */
  let y = tableTop + 40;

  doc.fillColor("#000");

  order.items.forEach((item: any) => {
    doc.fontSize(10).text(item.productName, 60, y);

    const variant = [
      item.color ? `Color : ${item.color}` : "",
      item.size ? `Size : ${item.size}` : "",
      item.sku ? `SKU : ${item.sku}` : "",
    ]
      .filter(Boolean)
      .join("   ");

    doc
      .fontSize(8)
      .fillColor(colors.gray)
      .text(variant, 60, y + 15);

    doc
      .fontSize(10)
      .fillColor("#000")
      .text(item.quantity, 310, y)
      .text(item.price, 380, y)
      .text(item.total, 460, y);

    y += 45;

    doc
      .strokeColor(colors.light)
      .moveTo(50, y - 8)
      .lineTo(550, y - 8)
      .stroke();
  });

  /* ================= TOTAL SECTION ================= */
  y += 20;

  doc.fontSize(9).text("Subtotal:", 380, y).text(order.subtotal, 470, y);

  doc
    .text(`${order.deliveryType}:`, 380, y + 15)
    .text(order.deliveryCharge, 470, y + 15);

  doc
    .moveTo(380, y + 35)
    .lineTo(550, y + 35)
    .stroke();

  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("Total :", 380, y + 50)
    .text(order.totalAmount, 470, y + 50);

  /* ================= PAYMENT BOX ================= */
  const payY = y + 100;

  doc.roundedRect(50, payY, 500, 60, 6).stroke();

  doc
    .fontSize(10)
    .text("PAYMENT METHOD", 60, payY + 10)
    .fontSize(9)
    .text(order.paymentMethod, 60, payY + 25);

  doc.text(
    `Payment Status : ${order.paymentStatus.toUpperCase()}`,
    300,
    payY + 25,
  );

  /* ================= TERMS ================= */
  doc.fontSize(10).text("TERMS & CONDITIONS", 50, payY + 90);

  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#444")
    .text(
      "• Returns or exchanges are accepted within 5 days of delivery, provided the item is unused and in its original packaging\n• Customers are responsible for return shipping costs, unless the product is defective or an error occurred on our end\n• Realo is not responsible for delays in delivery due to unforeseen events.",
      50,
      payY + 110,
      {
        width: 250,
        lineGap: 3,
      },
    );
  doc.end();
  return endPromise;
};