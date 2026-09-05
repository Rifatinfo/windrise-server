
import prisma from "../../../shared/prisma";
import bcrypt from "bcryptjs";
import ApiError from "../../errors/ApiError";
import { StatusCodes } from "http-status-codes";

import { Secret } from "jsonwebtoken";
import { envVars } from "@/config";
import { jwtHelper } from "@/app/helpers/jwtHelpers";
import { UserStatus } from "@prisma/client";
import { sendEmail } from "@/app/utils/sendEmail";
import { randomInt } from "crypto";
import {
  buildLoginOtpEmailHtml,
  buildLoginOtpEmailText,
} from "@/app/utils/otpEmail";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_PURGE_MINUTES,
  OTP_REQUIRED_ROLES,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_VALID_MINUTES,
} from "@/config/otp.config";


const convertToMs = (time: string): number => {
  const unit = time.slice(-1);
  const value = parseInt(time.slice(0, -1));

  switch (unit) {
    case "y":
      return value * 365 * 24 * 60 * 60 * 1000;
    case "M":
      return value * 30 * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "m":
      return value * 60 * 1000;
    case "s":
      return value * 1000;
    default:
      return 1000 * 60 * 60; // default 1h
  }
};

// ============================== Session issuing =============================

type SessionUser = {
  id: string;
  email: string | null;
  role: string;
  needPasswordChange: boolean;
};

/** Mint the access/refresh pair. The only place a session is created. */
const issueSession = (user: SessionUser) => {
  const accessTokenExpiresIn = envVars.JWT_SECRET_EXPIRES_IN as string;
  const refreshTokenExpiresIn = envVars.REFRESH_TOKEN_EXPIRES_IN as string;

  const claims = { id: user.id, email: user.email, role: user.role };

  return {
    accessToken: jwtHelper.generateToken(
      claims,
      envVars.JWT_SECRET as Secret,
      accessTokenExpiresIn,
    ),
    refreshToken: jwtHelper.generateToken(
      claims,
      envVars.REFRESH_TOKEN_SECRET as Secret,
      refreshTokenExpiresIn,
    ),
    accessTokenMaxAge: convertToMs(accessTokenExpiresIn),
    refreshTokenMaxAge: convertToMs(refreshTokenExpiresIn),
    needPasswordChange: user.needPasswordChange,
  };
};

// ============================ Staff one-time codes ==========================

const isOtpRole = (role: string) =>
  (OTP_REQUIRED_ROLES as readonly string[]).includes(role);

/** Delete every code whose 5-minute lifetime has run out. */
const purgeExpiredOtps = async () => {
  const { count } = await prisma.loginOtp.deleteMany({
    where: { purgeAt: { lte: new Date() } },
  });
  return count;
};

const generateOtpCode = () => {
  // crypto.randomInt is uniform, unlike Math.random scaled into a range.
  const max = 10 ** OTP_LENGTH;
  return randomInt(0, max).toString().padStart(OTP_LENGTH, "0");
};

/**
 * A short-lived ticket proving the password step already succeeded. It is
 * what the verify and resend endpoints authenticate against, so neither can
 * be used to mail codes to an admin without knowing their password.
 */
const signOtpTicket = (userId: string) =>
  jwtHelper.generateToken(
    { id: userId, purpose: "login-otp" },
    envVars.JWT_SECRET as Secret,
    `${OTP_PURGE_MINUTES}m`,
  );

const readOtpTicket = (ticket: string): string => {
  try {
    const decoded = jwtHelper.verifyToken(ticket, envVars.JWT_SECRET as Secret);
    if (decoded?.purpose !== "login-otp" || !decoded?.id) {
      throw new Error("wrong purpose");
    }
    return decoded.id as string;
  } catch {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "This sign-in attempt has expired. Please log in again.",
    );
  }
};

/** Create a code, store only its hash, and email it. */
const issueLoginOtp = async (user: {
  id: string;
  email: string | null;
  name: string | null;
}) => {
  await purgeExpiredOtps();

  if (!user.email) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This account has no email address, so a sign-in code cannot be sent.",
    );
  }

  // Only the newest code is ever valid — drop anything outstanding.
  await prisma.loginOtp.deleteMany({ where: { userId: user.id } });

  const code = generateOtpCode();
  const now = Date.now();

  await prisma.loginOtp.create({
    data: {
      userId: user.id,
      email: user.email,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(now + OTP_VALID_MINUTES * 60 * 1000),
      purgeAt: new Date(now + OTP_PURGE_MINUTES * 60 * 1000),
    },
  });

  const sent = await sendEmail({
    to: user.email,
    subject: `${code} is your Windrise sign-in code`,
    html: buildLoginOtpEmailHtml({
      name: user.name,
      code,
      validForMinutes: OTP_VALID_MINUTES,
    }),
    text: buildLoginOtpEmailText({ code, validForMinutes: OTP_VALID_MINUTES }),
  });

  if (!sent) {
    // Nothing was delivered, so leaving the row would lock the user out for
    // the cooldown with a code they can never read.
    await prisma.loginOtp.deleteMany({ where: { userId: user.id } });
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "We couldn't send your sign-in code. Please try again.",
    );
  }

  return {
    otpRequired: true as const,
    otpTicket: signOtpTicket(user.id),
    email: maskEmail(user.email),
    expiresInSeconds: OTP_VALID_MINUTES * 60,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
};

/** "mdrifat@gmail.com" -> "md•••••t@gmail.com" */
const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 2) return `${local[0]}•••@${domain}`;
  return `${local.slice(0, 2)}${"•".repeat(Math.min(local.length - 3, 6))}${local.slice(-1)}@${domain}`;
};

const login = async (payload: { email: string; password: string }) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: {
      email: payload.email,
      status: UserStatus.ACTIVE,
    },
  });

  const isCorrectPassword = await bcrypt.compare(
    payload.password,
    user.password as string,
  );

  if (!isCorrectPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect!");
  }

  // Staff never get a session straight from the password step — they have to
  // clear an emailed code first, every time they sign in.
  if (isOtpRole(user.role)) {
    return issueLoginOtp(user);
  }

  return issueSession(user);
};

/** Exchange a correct code for a session. */
const verifyLoginOtp = async (payload: { otpTicket: string; otp: string }) => {
  const userId = readOtpTicket(payload.otpTicket);
  await purgeExpiredOtps();

  const record = await prisma.loginOtp.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const expired = new ApiError(
    StatusCodes.BAD_REQUEST,
    "That code has expired. Request a new one.",
  );

  if (!record) throw expired;
  if (record.expiresAt.getTime() <= Date.now()) throw expired;

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.loginOtp.delete({ where: { id: record.id } });
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      "Too many incorrect codes. Request a new one.",
    );
  }

  const matches = await bcrypt.compare(payload.otp.trim(), record.codeHash);

  if (!matches) {
    const { attempts } = await prisma.loginOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });

    const left = Math.max(OTP_MAX_ATTEMPTS - attempts, 0);
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      left > 0
        ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
        : "Too many incorrect codes. Request a new one.",
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId, status: UserStatus.ACTIVE },
  });

  // Burn it before handing out the session so it can never be replayed.
  await prisma.loginOtp.delete({ where: { id: record.id } });

  return issueSession(user);
};

/** Send a fresh code for an in-flight sign-in. */
const resendLoginOtp = async (payload: { otpTicket: string }) => {
  const userId = readOtpTicket(payload.otpTicket);
  await purgeExpiredOtps();

  const existing = await prisma.loginOtp.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const waited = (Date.now() - existing.createdAt.getTime()) / 1000;
    if (waited < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - waited)}s before requesting another code.`,
      );
    }
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId, status: UserStatus.ACTIVE },
  });

  return issueLoginOtp(user);
};

const refreshToken = async (token: string) => {
  let decodedData;

  try {
    decodedData = jwtHelper.verifyToken(
      token,
      envVars.REFRESH_TOKEN_SECRET as Secret,
    );
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "You are not authorized!");
  }

  const userData = await prisma.user.findUniqueOrThrow({
    where: {
      email: decodedData.email,
    },
  });

  if (userData.status !== UserStatus.ACTIVE) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User is not active");
  }

  const accessTokenExpiresIn = envVars.JWT_SECRET_EXPIRES_IN as string;

  const accessToken = jwtHelper.generateToken(
    {
      id: userData.id,
      email: userData.email,
      role: userData.role,
    },
    envVars.JWT_SECRET as Secret,
    accessTokenExpiresIn,
  );

  return {
    accessToken,
    accessTokenMaxAge: convertToMs(accessTokenExpiresIn),
    needPasswordChange: userData.needPasswordChange,
  };
};
const getMe = async (session: any) => {
  const userData = await prisma.user.findUniqueOrThrow({
    where: {
      email: session.email,
      status: UserStatus.ACTIVE,
    },
    include: {
      admin: true,
      customer: true,
      shopManager: true,
      mediaManager: true,
    },
  });

  const { id, email, role, needPasswordChange, status, admin, customer, shopManager, mediaManager } = userData;

  return {
    id,
    email,
    role,
    needPasswordChange,
    status,
    name: userData.name || admin?.name || customer?.name || shopManager?.name || mediaManager?.name,
    admin,
    customer,
    shopManager,
    mediaManager,
  };
};

const forgotPassword = async (payload: { email: string }) => {
  const userData = await prisma.user.findUniqueOrThrow({
    where: {
      email: payload.email,
      status: UserStatus.ACTIVE,
    },
  });
  if (!userData.email) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User email not found");
  }
  console.log(
    "Secreate : ",
    envVars.RESET_PASS_SECRET,
    envVars.RESET_PASS_TOKEN_EXPIRES_IN,
  );
  const resetPassToken = jwtHelper.generateToken(
    { email: userData.email!, role: userData.role },
    envVars.RESET_PASS_SECRET as Secret,
    envVars.RESET_PASS_TOKEN_EXPIRES_IN as string,
  );

  // const resetPassLink = `${envVars.RESET_PASS_LINK}?email=${encodeURIComponent(userData.email)}&userId=${userData.id}&token=${resetPassToken}`;

  const resetPassLink =
    envVars.RESET_PASS_LINK +
    `?email=${encodeURIComponent(userData.email)}&token=${resetPassToken}`;

  await sendEmail({
    to: userData.email,
    subject: "Reset Your Password",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 20px 40px; text-align: center; background: linear-gradient(135deg, #FF5000 0%, #FF5000 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Mi Shop</h1>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="margin: 0 0 20px 0; color: #333333; font-size: 24px; font-weight: 600;">Reset Your Password</h2>

                            <p style="margin: 0 0 20px 0; color: #666666; font-size: 16px; line-height: 24px;">
                                Hello <%= name %>,
                            </p>

                            <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 24px;">
                                We received a request to reset your password for your Mi Shop account. Click the button below to create a new password:
                            </p>

                            <!-- Button -->
                            <table role="presentation" style="margin: 0 auto;">
                                <tr>
                                    <td style="border-radius: 6px; background: linear-gradient(135deg, #FF5000 0%, #FF5000 100%);">
                                        <a href="<%= resetLink %>" style="border: none; color: #ffffff; padding: 14px 32px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block; border-radius: 6px;">
                                            Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin: 30px 0 20px 0; color: #666666; font-size: 14px; line-height: 20px;">
                                Or copy and paste this link into your browser:
                            </p>

                            <p style="margin: 0 0 30px 0; color: #FF5000; font-size: 14px; line-height: 20px; word-break: break-all;">
                                <%= resetLink %>
                            </p>

                            <div style="border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 30px;">
                                <p style="margin: 0 0 10px 0; color: #999999; font-size: 14px; line-height: 20px;">
                                    <strong>Security Notice:</strong>
                                </p>
                                <ul style="margin: 0 0 20px 0; padding-left: 20px; color: #999999; font-size: 14px; line-height: 20px;">
                                    <li>This link will expire in 15 minutes</li>
                                    <li>If you didn't request this password reset, please ignore this email</li>
                                    <li>For security reasons, never share this link with anyone</li>
                                </ul>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0 0 10px 0; color: #999999; font-size: 14px;">
                                © <%= year %> Mi Shop. All rights reserved.
                            </p>
                            <p style="margin: 0; color: #999999; font-size: 12px;">
                                This is an automated email. Please do not reply.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
               </html>`,
    templateData: {
      name: userData.name ?? "User",
      resetLink: resetPassLink,
      year: new Date().getFullYear(),
    },
  });
};

const resetPassword = async (
  token: string | null,
  payload: { email?: string; password: string },
  user?: { email: string },
) => {
  let userEmail: string;
  console.log("Token", token, "user", user);
  // Case 1: Token-based reset (from forgot password email)
  if (token) {
    const decodedToken = jwtHelper.verifyToken(
      token,
      envVars.RESET_PASS_SECRET as Secret,
    );
    // const decodedToken = jwtHelper.verifyToken(token, envVars.JWT_SECRET! as Secret)

    if (!decodedToken) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Invalid or expired reset token!",
      );
    }

    // Verify email from token matches the email in payload
    if (payload.email && decodedToken.email !== payload.email) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Email mismatch! Invalid reset request.",
      );
    }

    userEmail = decodedToken.email;
  }
  // Case 2: Authenticated user with needPasswordChange (newly created admin/doctor)
  else if (user && user.email) {
    const authenticatedUser = await prisma.user.findUniqueOrThrow({
      where: {
        email: user.email,
        status: UserStatus.ACTIVE,
      },
    });

    // Verify user actually needs password change
    if (!authenticatedUser.needPasswordChange) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You don't need to reset your password. Use change password instead.",
      );
    }

    userEmail = user.email;
  } else {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid request. Either provide a valid token or be authenticated.",
    );
  }

  // hash password
  const password = await bcrypt.hash(
    payload.password,
    Number(envVars.BCRYPT_SALT_ROUNDS),
  );

  // update into database
  await prisma.user.update({
    where: {
      email: userEmail,
    },
    data: {
      password,
      needPasswordChange: true,
    },
  });
};

const changePassword = async (user: any, payload: any) => {
  const userData = await prisma.user.findUniqueOrThrow({
    where: {
      email: user.email,
      status: UserStatus.ACTIVE,
    },
  });

  if (!userData.password) {
    throw new Error("User password not found!");
  }
  if (!userData.email) {
    throw new Error("User email not found");
  }

  const isCorrectPassword = await bcrypt.compare(
    payload.oldPassword,
    userData.password,
  );

  if (!isCorrectPassword) {
    throw new Error("Password incorrect!");
  }

  const hashedPassword = await bcrypt.hash(
    payload.newPassword,
    Number(envVars.BCRYPT_SALT_ROUNDS),
  );

  await prisma.user.update({
    where: {
      email: userData.email,
    },
    data: {
      password: hashedPassword,
      needPasswordChange: true,
    },
  });

  return {
    message: "Password changed successfully!",
  };
};

export const AuthService = {
  login,
  verifyLoginOtp,
  resendLoginOtp,
  purgeExpiredOtps,
  refreshToken,
  getMe,
  resetPassword,
  forgotPassword,
  changePassword,
};
