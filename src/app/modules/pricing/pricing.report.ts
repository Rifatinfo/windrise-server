import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

import type { PricingInput, PricingResult, PricingTier } from "./pricing.calc";

const money = (value: number, currency: string) =>
  `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * A one-page pricing report. Every figure is passed in already recomputed by
 * the service, never taken from the browser.
 */
export const buildPricingReport = ({
  productName,
  currency,
  input,
  result,
  tiers,
}: {
  productName: string;
  currency: string;
  input: PricingInput;
  result: PricingResult;
  tiers: PricingTier[];
}): Promise<Buffer> => {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];

  doc.pipe(stream);
  stream.on("data", (chunk) => chunks.push(chunk as Buffer));

  const done = new Promise<Buffer>((resolve, reject) => {
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  doc.fontSize(20).fillColor("#0b0b0b").text("Pricing Report", { continued: false });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor("#666666").text(productName || "Untitled product");
  doc.fontSize(9).text(new Date().toLocaleString());
  doc.moveDown(1);

  doc.fontSize(13).fillColor("#0b0b0b").text("Suggested selling price");
  doc.fontSize(24).fillColor("#4f46e5").text(money(result.sellingPrice, currency));
  doc
    .fontSize(9)
    .fillColor("#666666")
    .text(
      `${result.marginAchieved.toFixed(1)}% margin achieved · ${input.marginMode === "MARGIN" ? "margin on selling price" : "markup on cost"}`,
    );
  doc.moveDown(1);

  const line = (label: string, value: string) => {
    doc.fontSize(10).fillColor("#333333").text(`${label}:  `, { continued: true });
    doc.fillColor("#0b0b0b").text(value);
  };

  doc.fontSize(13).fillColor("#0b0b0b").text("Summary");
  doc.moveDown(0.3);
  line("Total cost / unit", money(result.totalCost, currency));
  line("Profit / unit", money(result.profitPerUnit, currency));
  line(
    `Platform fee (${input.platformFee}${input.platformFeeMode === "PERCENT" ? "%" : ` ${currency}`})`,
    money(result.platformFeeAmount, currency),
  );
  line(`Tax (${input.taxPercent}%)`, money(result.taxAmount, currency));
  doc.moveDown(1);

  doc.fontSize(13).fillColor("#0b0b0b").text("Cost breakdown");
  doc.moveDown(0.3);
  for (const item of result.breakdown) {
    line(item.label, `${money(item.amount, currency)}  (${item.percent.toFixed(1)}%)`);
  }
  doc.moveDown(1);

  doc.fontSize(13).fillColor("#0b0b0b").text("Margin tiers");
  doc.moveDown(0.3);
  for (const tier of tiers) {
    const label = `${tier.label} (${tier.margin}%)${tier.isCurrent ? "  <- selected" : ""}`;
    line(
      label,
      tier.price === null
        ? "not achievable at this fee + tax"
        : `${money(tier.price, currency)}  ·  profit ${money(tier.profit ?? 0, currency)}`,
    );
  }

  if (result.warnings.length > 0) {
    doc.moveDown(1);
    doc.fontSize(13).fillColor("#b45309").text("Notes");
    doc.moveDown(0.3);
    for (const warning of result.warnings) {
      doc.fontSize(9).fillColor("#92400e").text(`• ${warning}`);
    }
  }

  doc.end();
  return done;
};
