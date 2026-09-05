import ejs from "ejs";
import nodemailer from "nodemailer";
import path from "path";
import { envVars } from "../../config";

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: envVars.SMTP_USER,
        pass: envVars.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: false,
    },
});

// async verify (better practice)
transporter.verify((error, success) => {
    if (error) {
        console.error("❌ SMTP connection failed:", error);
    } else {
        console.log("✅ SMTP Server is ready");
    }
});

interface SendEmailOptions {
    to: string;
    subject: string;

    /** Plain-text alternative, used by clients that do not render HTML. */
    text?: string;

    // OPTION 1: direct HTML string (recommended)
    html?: string;

    // OPTION 2: EJS template file (optional)
    templateName?: string;
    templateData?: Record<string, any>;

    // PDF / files (invoice support)
    attachments?: {
        filename: string;
        content: Buffer | string;
        contentType: string;
    }[];
}

export const sendEmail = async ({
    to,
    subject,
    html,
    text,
    templateName,
    templateData,
    attachments,
}: SendEmailOptions) => {
    try {
        let finalHtml = "";

        /**
         * 1️⃣ If templateName exists → use EJS FILE
         */
        if (templateName) {
            const templatePath = path.join(
                process.cwd(),
                "templates",
                `${templateName}.ejs`
            );

            finalHtml = await ejs.renderFile(templatePath, templateData || {});
        }

        /**
         * 2️⃣ If NO template file → use direct HTML
         *    (this is your main requirement)
         */
        else if (html) {
            finalHtml = templateData
                ? ejs.render(html, templateData) // supports variables like {{name}}
                : html; // pure HTML, no processing
        }

        /**
         * 3️⃣ Validation
         */
        if (!finalHtml) {
            throw new Error("No email content provided (html or template required)");
        }

        /**
         * 4️⃣ Send Email
         */
        const info = await transporter.sendMail({
            from: envVars.SMTP_FROM,
            to,
            subject,
            html: finalHtml,
            text,
            attachments,
        });

        console.log(`📧 Email sent successfully to ${to}: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error("❌ Email send failed:", error);
        return false;
    }
};


export function buildOrderEmailHtml(result: any): string {
  const BRAND = "#D94D1B";
  const DARK = "#000000";
  const MUTED = "#6b7280";
  const BORDER = "#e5e7eb";
  const LIGHT = "#f9fafb";
  const SOFT = "#fff3ee";

  const itemsHtml = result.items
    ?.map(
      (item: any, index: number) => `
      <tr>
        <td style="padding:16px;border-bottom:${
          index !== result.items.length - 1 ? `1px solid ${BORDER}` : "none"
        };vertical-align:top;">

          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="70" style="vertical-align:top;">
                <img
                  src="${process.env.NEXT_PUBLIC_API_URL}${item.thumbnailImage || ""}"
                  alt="${item.productName}"
                  width="56"
                  height="56"
                  style="display:block;border-radius:8px;object-fit:cover;border:1px solid ${BORDER};"
                />
              </td>

              <td style="padding-left:14px;vertical-align:top;">
                <p style="margin:0;font-size:14px;font-weight:700;color:${DARK};line-height:1.5;">
                  ${item.productName || ""}
                </p>

                <p style="margin:6px 0 0;font-size:12px;color:${MUTED};">
                  Color: ${item.color || "-"} |
                  Size: ${item.size || "-"} |
                  Qty: ${item.quantity || 0}
                </p>

                <p style="margin:6px 0 0;font-size:12px;color:${MUTED};">
                  ${item.price || 0} TK each
                </p>
              </td>

              <td align="right" style="vertical-align:top;">
                <p style="margin:0;font-size:14px;font-weight:700;color:${BRAND};">
                  ${item.total || 0} TK
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>
    `
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Order Confirmation</title>
</head>

<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:30px 0;">
    <tr>
      <td align="center">

        <!-- Main Container -->
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${BORDER};">

          <!-- Header -->
          <tr>
            <td style="background:${BRAND};padding:32px;">

              <p style="margin:0;font-size:12px;letter-spacing:1px;color:#ffffff;font-weight:700;text-transform:uppercase;opacity:0.9;">
                ORDER CONFIRMED
              </p>

              <h1 style="margin:14px 0 8px;font-size:24px;color:#ffffff;line-height:1.4;">
                Thank you, ${result.name}
              </h1>

              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.85);line-height:1.7;">
                Your order has been placed successfully and is now being processed.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">

              <!-- Order Info -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>

                  <td width="33%" style="padding:12px;background:${LIGHT};border:1px solid ${BORDER};border-radius:8px;">
                    <p style="margin:0;font-size:11px;color:${MUTED};font-weight:700;text-transform:uppercase;">
                      Order ID
                    </p>
                    <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:${BRAND};">
                      #${result.id}
                    </p>
                  </td>

                  <td width="2%"></td>

                  <td width="33%" style="padding:12px;background:${LIGHT};border:1px solid ${BORDER};border-radius:8px;">
                    <p style="margin:0;font-size:11px;color:${MUTED};font-weight:700;text-transform:uppercase;">
                      Payment
                    </p>
                    <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:${DARK};">
                      ${result.paymentMethod}
                    </p>
                  </td>

                  <td width="2%"></td>

                  <td width="33%" style="padding:12px;background:${LIGHT};border:1px solid ${BORDER};border-radius:8px;">
                    <p style="margin:0;font-size:11px;color:${MUTED};font-weight:700;text-transform:uppercase;">
                      Delivery
                    </p>
                    <p style="margin:6px 0 0;font-size:14px;font-weight:700;color:${DARK};">
                      ${String(result.deliveryType || "")
                        .replace("_", " ")
                        .toUpperCase()}
                    </p>
                  </td>

                </tr>
              </table>

              <!-- Items -->
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${DARK};">
                Ordered Items
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="border:1px solid ${BORDER};border-radius:12px;overflow:hidden;margin-bottom:24px;">
                ${itemsHtml}
              </table>

              <!-- Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:${LIGHT};border:1px solid ${BORDER};border-radius:12px;padding:20px;margin-bottom:24px;">

                <tr>
                  <td style="padding-bottom:10px;font-size:14px;color:${MUTED};">
                    Subtotal
                  </td>
                  <td align="right" style="padding-bottom:10px;font-size:14px;color:${DARK};">
                    ${result.subtotal} TK
                  </td>
                </tr>

                <tr>
                  <td style="padding-bottom:14px;font-size:14px;color:${MUTED};border-bottom:1px solid ${BORDER};">
                    Shipping
                  </td>
                  <td align="right" style="padding-bottom:14px;font-size:14px;color:${DARK};border-bottom:1px solid ${BORDER};">
                    ${result.deliveryCharge} TK
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:16px;font-size:16px;font-weight:700;color:${DARK};">
                    Total
                  </td>
                  <td align="right" style="padding-top:16px;font-size:22px;font-weight:700;color:${BRAND};">
                    ${result.totalAmount} TK
                  </td>
                </tr>

              </table>

              <!-- Address -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="border:1px solid ${BORDER};border-radius:12px;padding:20px;margin-bottom:24px;">

                <tr>
                  <td>
                    <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;">
                      Delivery Address
                    </p>

                    <p style="margin:0;font-size:15px;font-weight:700;color:${DARK};">
                      ${result.name}
                    </p>

                    <p style="margin:8px 0 0;font-size:14px;color:${MUTED};line-height:1.7;">
                      ${result.address}, ${result.state}
                    </p>

                    <p style="margin:4px 0 0;font-size:14px;color:${MUTED};">
                      ${result.phone}
                    </p>
                  </td>
                </tr>

              </table>

              <!-- Invoice Notice -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:${SOFT};border:1px solid rgba(217,77,27,0.25);border-radius:12px;padding:16px;">

                <tr>
                  <td style="font-size:14px;color:${DARK};line-height:1.7;">
                    A PDF invoice is attached with this email for your records.
                  </td>
                </tr>

              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:${LIGHT};border-top:1px solid ${BORDER};">

              <p style="margin:0;font-size:12px;color:${MUTED};text-align:center;">
                Thank you for shopping with us 
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
  `.trim();
}