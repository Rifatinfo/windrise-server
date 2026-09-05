
import { User } from "@prisma/client";
import { jwtHelper } from "../helpers/jwtHelpers";
import { envVars } from "../../config";

export const createUserTokens = (user: User) => {
  const payload = {
    id: user.id,
    role: user.role,
    email: user.email,
  };
  
  
  const accessToken = jwtHelper.generateToken(
    payload,
    envVars.JWT_SECRET as string,
    envVars.ACCESS_TOKEN_EXPIRY as string
  );

  const refreshToken = jwtHelper.generateToken(
    payload,
    envVars.REFRESH_TOKEN_SECRET as string,
    envVars.REFRESH_TOKEN_EXPIRY as string
  );

  return {
    accessToken,
    refreshToken,
  };
};