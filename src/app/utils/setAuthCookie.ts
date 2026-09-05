
import { Response } from "express";

type TokenInfo = {
  accessToken: string;
  refreshToken: string;
};

export const setAuthCookie = (res: Response, tokenInfo: TokenInfo) => {
  const isProduction = process.env.NODE_ENV === "production";

  // Access Token (short-lived)
  res.cookie("accessToken", tokenInfo.accessToken, {
    secure: isProduction,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60,  // 1 hour
  });

  // Refresh Token (long-lived)
  res.cookie("refreshToken", tokenInfo.refreshToken, {
    secure: isProduction,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 90, // 90 days
  });
};