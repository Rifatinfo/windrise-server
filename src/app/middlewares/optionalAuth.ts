import { NextFunction, Request, Response } from "express";
import { Secret } from "jsonwebtoken";
import { envVars } from "../../config";
import { jwtHelper } from "../helpers/jwtHelpers";

const optionalAuth = async (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction,
) => {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (token) {
      const verifiedUser = jwtHelper.verifyToken(token, envVars.JWT_SECRET as Secret);
      req.user = verifiedUser;
    }

    next();
  } catch {
    // If token is invalid, still proceed as guest
    next();
  }
};

export default optionalAuth;
