import prisma from "../../../shared/prisma";
import { envVars } from "@/config";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiError";
import { generateUserSlug } from "@/app/utils/generateUserSlug";
import { jwtHelper } from "@/app/helpers/jwtHelpers";
import { Secret } from "jsonwebtoken";

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
  verified_email: boolean;
}

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const getGoogleAuthUrl = (redirect?: string): string => {
  const params = new URLSearchParams({
    client_id: envVars.GOOGLE_CLIENT_ID,
    redirect_uri: envVars.GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });

  if (redirect) {
    params.set("state", redirect);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const exchangeCodeForTokens = async (code: string): Promise<{ access_token: string }> => {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: envVars.GOOGLE_CLIENT_ID,
      client_secret: envVars.GOOGLE_CLIENT_SECRET,
      redirect_uri: envVars.GOOGLE_CALLBACK_URL,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Failed to exchange authorization code for tokens"
    );
  }

  return tokenResponse.json() as Promise<{ access_token: string }>;
};

export const getGoogleUserInfo = async (accessToken: string) => {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Failed to fetch user info from Google"
    );
  }

  return response.json() as Promise<GoogleUserInfo>;
};

export const findOrCreateGoogleUser = async (googleUser: GoogleUserInfo) => {
  const existingAuthProvider = await prisma.authProvider.findUnique({
    where: {
      provider_providerId: {
        provider: "GOOGLE",
        providerId: googleUser.id,
      },
    },
    include: { user: true },
  });

  if (existingAuthProvider) {
    return existingAuthProvider.user;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: googleUser.email },
  });

  if (existingUser) {
    await prisma.authProvider.create({
      data: {
        provider: "GOOGLE",
        providerId: googleUser.id,
        userId: existingUser.id,
      },
    });

    return existingUser;
  }

  const slug = generateUserSlug(googleUser.name);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: googleUser.email,
        name: googleUser.name,
        avatar: googleUser.picture,
        slug,
        role: "CUSTOMER",
        needPasswordChange: false,
        status: "ACTIVE",
      },
    });

    await tx.authProvider.create({
      data: {
        provider: "GOOGLE",
        providerId: googleUser.id,
        userId: newUser.id,
      },
    });

    await tx.customer.create({
      data: {
        userId: newUser.id,
        name: googleUser.name,
        email: googleUser.email,
        avatar: googleUser.picture,
      },
    });

    return newUser;
  });

  return user;
};

export const generateGoogleUserTokens = (user: { email: string | null; role: string; id: string }) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtHelper.generateToken(
    payload,
    envVars.JWT_SECRET as Secret,
    envVars.ACCESS_TOKEN_EXPIRY || "1h"
  );

  const refreshToken = jwtHelper.generateToken(
    payload,
    envVars.REFRESH_TOKEN_SECRET as Secret,
    envVars.REFRESH_TOKEN_EXPIRY || "7d"
  );

  return { accessToken, refreshToken };
};
