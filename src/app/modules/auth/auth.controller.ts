import { Request, Response } from "express"
import catchAsync from "../../../shared/catchAsync"
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { AuthService } from "./auth.service";
import ApiError from "../../errors/ApiError";



type SessionResult = Awaited<ReturnType<typeof AuthService.verifyLoginOtp>>;
type LoginResult = Awaited<ReturnType<typeof AuthService.login>>;

const isOtpChallenge = (
    result: LoginResult,
): result is Extract<LoginResult, { otpRequired: true }> =>
    "otpRequired" in result;

/** Put a freshly minted session on the response as cookies. */
const setSessionCookies = (res: Response, session: SessionResult) => {
    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("accessToken", session.accessToken, {
        secure: isProduction,
        httpOnly: true,
        sameSite: "lax",
        maxAge: session.accessTokenMaxAge,
    });

    res.cookie("refreshToken", session.refreshToken, {
        secure: isProduction,
        httpOnly: true,
        sameSite: "lax",
        maxAge: session.refreshTokenMaxAge,
    });
};

const login = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.login(req.body);

    // Staff roles get a code by email instead of a session. No cookies are set
    // here — the session only exists once the code is verified.
    if (isOtpChallenge(result)) {
        return sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: "A sign-in code has been sent to your email.",
            data: result,
        });
    }

    setSessionCookies(res, result);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: "User Login Successfully!",
        data: {
            needPasswordChange: result.needPasswordChange,
        },
    });
});

const verifyLoginOtp = catchAsync(async (req: Request, res: Response) => {
    const session = await AuthService.verifyLoginOtp(req.body);

    setSessionCookies(res, session);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "User Login Successfully!",
        data: {
            needPasswordChange: session.needPasswordChange,
        },
    });
});

const resendLoginOtp = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.resendLoginOtp(req.body);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "A new sign-in code has been sent to your email.",
        data: result,
    });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken;

    if (!token) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Refresh token missing!");
    }

    const result = await AuthService.refreshToken(token);

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("accessToken", result.accessToken, {
        secure: isProduction,
        httpOnly: true,
        sameSite: "lax",
        maxAge: result.accessTokenMaxAge,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Access token generated successfully!",
        data: {
            message: "Access token generated successfully!",
        },
    });
})

const changePassword = catchAsync(
    async (req: Request & { user?: any }, res: Response) => {
        const user = req.user;

        const result = await AuthService.changePassword(user, req.body);

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: "Password Changed successfully",
            data: result,
        });
    }
);

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
    await AuthService.forgotPassword(req.body);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Check your email!",
        data: null,
    });
});

const resetPassword = catchAsync(async (req: Request & { user?: any }, res: Response) => {
    const token = req.headers.authorization?.split(" ")[1];
    const user = req.user; 
    console.log("TokenC : ", token, "UserC", user);
    await AuthService.resetPassword(token as string, req.body, user);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Password Reset!",
        data: null,
    });
});

const getMe = catchAsync(async (req: Request & { user?: any }, res: Response) => {
    const result = await AuthService.getMe(req.user);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "User info retrieved!",
        data: result,
    });
});


export const AuthController = {
    login,
    verifyLoginOtp,
    resendLoginOtp,
    refreshToken,
    changePassword,
    forgotPassword,
    resetPassword,
    getMe,
}