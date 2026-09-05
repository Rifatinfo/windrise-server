/**
 * Sign-in code email for staff logins.
 *
 * The code is rendered as plain selectable text — not an image and not split
 * across elements — with `user-select: all` so one click or tap selects the
 * whole thing. It is also repeated in the plain-text part and in the subject
 * preview, which is what most mail clients and phone keyboards read when they
 * offer to autofill a code.
 */
export const buildLoginOtpEmailHtml = ({
  name,
  code,
  validForMinutes,
  storeName = "Windrise",
}: {
  name?: string | null;
  code: string;
  validForMinutes: number;
  storeName?: string;
}) => {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(storeName)} sign-in code</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <!-- Preview text: many clients surface this next to the subject line -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${code} is your ${escapeHtml(storeName)} sign-in code. It expires in ${validForMinutes} minutes.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:#0b0b0b;padding:22px 32px;">
                <span style="color:#ffffff;font-size:19px;font-weight:600;letter-spacing:0.04em;">${escapeHtml(storeName)}</span>
              </td>
            </tr>

            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <h1 style="margin:0 0 6px 0;font-size:19px;line-height:1.35;color:#111111;font-weight:600;">
                  Your sign-in code
                </h1>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#4a4a4a;">
                  ${greeting} use the code below to finish signing in to your
                  ${escapeHtml(storeName)} dashboard.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 32px 6px 32px;">
                <div style="background:#f6f6f7;border:1px solid #e6e6e8;border-radius:10px;padding:22px 16px;text-align:center;">
                  <!-- user-select:all makes a single click select the whole code -->
                  <span style="display:inline-block;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:0.24em;color:#0b0b0b;-webkit-user-select:all;user-select:all;">${code}</span>
                </div>
                <p style="margin:12px 0 0 0;text-align:center;font-size:12px;color:#8f8f8f;">
                  Tap or click the code to select it, then copy.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 32px 0 32px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#4a4a4a;">
                  This code expires in <strong>${validForMinutes} minutes</strong> and can be
                  used once.
                </p>
                <p style="margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#8f8f8f;">
                  Didn't try to sign in? You can ignore this email — your account
                  is safe and nobody can get in without this code.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:26px 32px 30px 32px;">
                <hr style="border:none;border-top:1px solid #ededee;margin:0 0 16px 0;" />
                <p style="margin:0;font-size:11px;line-height:1.6;color:#a3a3a3;">
                  This is an automated message from ${escapeHtml(storeName)}. Please do not
                  reply. Never share this code with anyone, including someone
                  claiming to be from ${escapeHtml(storeName)}.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:18px 0 0 0;font-size:11px;color:#a3a3a3;">
            &copy; ${new Date().getFullYear()} ${escapeHtml(storeName)}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

/** Plain-text fallback. Kept simple so the code survives any mail client. */
export const buildLoginOtpEmailText = ({
  code,
  validForMinutes,
  storeName = "Windrise",
}: {
  code: string;
  validForMinutes: number;
  storeName?: string;
}) =>
  [
    `${code} is your ${storeName} sign-in code.`,
    ``,
    `It expires in ${validForMinutes} minutes and can be used once.`,
    ``,
    `Didn't try to sign in? Ignore this email — nobody can get in without this code.`,
    `Never share this code with anyone.`,
  ].join("\n");

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
