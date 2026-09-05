import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  findOrCreateGoogleUser,
  generateGoogleUserTokens,
} from "./googleOAuth.service";
import { envVars } from "@/config";
import { setAuthCookie } from "@/app/utils/setAuthCookie";

const googleAuth = catchAsync(async (req: Request, res: Response) => {
  const redirect = (req.query.redirect as string) || undefined;
  const url = getGoogleAuthUrl(redirect);
  res.redirect(url);
});

const googleCallback = catchAsync(async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || typeof code !== "string") {
    return res.redirect(
      `${envVars.FRONTEND_URL}/login?error=google-auth-failed`
    );
  }

  try {
    const tokenData = await exchangeCodeForTokens(code);
    const googleUser = await getGoogleUserInfo(tokenData.access_token);
    const user = await findOrCreateGoogleUser(googleUser);
    const tokens = generateGoogleUserTokens(user);

    setAuthCookie(res, tokens);

    const redirectTo = state && typeof state === "string" ? state : "";
    res.redirect(`${envVars.FRONTEND_URL}${redirectTo}?loggedIn=true`);
  } catch (error: any) {
    console.error("Google OAuth callback error:", error);
    res.redirect(
      `${envVars.FRONTEND_URL}/login?error=google-auth-failed`
    );
  }
});

export const GoogleOAuthController = {
  googleAuth,
  googleCallback,
};
