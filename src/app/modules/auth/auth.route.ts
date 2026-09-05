
import express, { NextFunction, Request, Response } from 'express'
import { AuthController } from './auth.controller';
import auth from '../../middlewares/auth';
import {
    authRateLimiter,
    otpResendRateLimiter,
    otpVerifyRateLimiter,
} from '../../../app/middlewares/rateLimiter';
import { UserRole } from '@prisma/client';
import { GoogleOAuthController } from './googleOAuth.controller';


const router = express.Router();


router.post(
    "/login",
    authRateLimiter,
    AuthController.login
)

// Staff sign-in second step. Both are guarded by the short-lived OTP ticket
// the login step returns, and rate limited so codes cannot be brute forced.
router.post(
    "/verify-otp",
    otpVerifyRateLimiter,
    AuthController.verifyLoginOtp
)

router.post(
    "/resend-otp",
    otpResendRateLimiter,
    AuthController.resendLoginOtp
)

router.post(
    '/refresh-token',
    AuthController.refreshToken
)

router.post(
    '/change-password',
    auth(
        UserRole.ADMIN,
        UserRole.CUSTOMER,
        UserRole.SHOP_MANAGER,
        UserRole.MEDIA_MANAGER,
    ),
    AuthController.changePassword
);

router.post(
    '/forgot-password',
    AuthController.forgotPassword
);

router.post(
    '/reset-password',
    (req: Request, res: Response, next: NextFunction) => {

        //user is resetting password without token and logged in newly created admin 
        if (!req.headers.authorization && req.cookies.accessToken) {
            console.log(req.headers.authorization, "from reset password route guard");
            console.log(req.cookies.accessToken, "from reset password route guard");
            auth(
                UserRole.ADMIN,
                UserRole.CUSTOMER,
                UserRole.SHOP_MANAGER,
                UserRole.MEDIA_MANAGER,
            ) 
            
            (req, res, next);
        } else {
            //user is resetting password via email link with token
            next();
        }
    },
    AuthController.resetPassword
)

router.get(
    '/google',
    GoogleOAuthController.googleAuth
);

router.get(
    '/google/callback',
    GoogleOAuthController.googleCallback
);

router.get(
    '/me',
    auth(
        UserRole.ADMIN,
        UserRole.CUSTOMER,
        UserRole.SHOP_MANAGER,
        UserRole.MEDIA_MANAGER,
    ),
    AuthController.getMe
);


export const AuthRoutes = router;

