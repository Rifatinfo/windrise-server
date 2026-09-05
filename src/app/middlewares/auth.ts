import { NextFunction, Response,Request } from "express"
import ApiError from "../errors/ApiError";
import { StatusCodes } from "http-status-codes";

import { Secret } from "jsonwebtoken";
import { jwtHelper } from "../helpers/jwtHelpers";
import { envVars } from "../../config";


const auth = (...roles: string[]) => {
    return async (req: Request & { user?: any }, res: Response, next: NextFunction) => {
        try {
            // const token = req.headers.authorization || req.cookies.accessToken;
            let token: string | undefined;
            const authHeader = req.headers.authorization;
            if(authHeader?.startsWith("Bearer ")){
               token =  authHeader.split(" ")[1];
            }else if(req.cookies?.accessToken){
               token = req.cookies.accessToken;
            }
            console.log({ token }, "from auth guard");

            if (!token) {
                throw new ApiError(StatusCodes.UNAUTHORIZED, "You are not authorized!")
            }

            const verifiedUser = jwtHelper.verifyToken(token, envVars.JWT_SECRET as Secret);

            req.user = verifiedUser;

            if(roles.length && !roles.includes(verifiedUser.role)){
                throw new ApiError(StatusCodes.FORBIDDEN, "Forbidden!")
            }
            next();

        } catch (err) {
            next(err);
        }
    }
}

export default auth;