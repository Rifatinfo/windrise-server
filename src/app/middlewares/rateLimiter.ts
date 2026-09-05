import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many requests. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many authentication attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
export const paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: "Too many payment attempts, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Guards the public order-tracking lookup. The phone number is the only
 * secret protecting an order, so wrong guesses are capped tightly.
 *
 * Only failed lookups count (`skipSuccessfulRequests`): brute-forcing an
 * order/phone pair produces misses, whereas a customer watching their own
 * order — the page re-checks for status changes while it is open — only ever
 * produces hits and is never throttled.
 */
export const orderTrackRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many tracking attempts. Please try again in a few minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});


/**
 * Caps guesses at the emailed sign-in code. The code is six digits, so without
 * this an attacker holding a valid OTP ticket could walk the whole space. The
 * per-code attempt counter in the database is the second line of defence.
 */
export const otpVerifyRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many attempts. Please request a new code shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Stops the resend button being used to flood an inbox. */
export const otpResendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many code requests. Please try again in a few minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Windee's message endpoint. Every call reaches a paid model, so unlike the
 * tracking limiter this one counts successes too — the cost is incurred
 * whether or not the answer was useful.
 */
export const chatbotRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    statusCode: 429,
    message: "You're sending messages a bit fast. Give Windee a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Review submission is open to guests, so it is capped per IP. Generous enough
 * for someone filling in a form and retrying, tight enough that the endpoint
 * cannot be used to flood the product page.
 */
export const reviewRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    statusCode: 429,
    message: "Too many review attempts. Please try again in a few minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Comments are open to guests, so they are capped per IP — generous enough for
 * a real conversation, tight enough that the endpoint cannot be used to flood a
 * story.
 */
export const commentRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: {
    success: false,
    statusCode: 429,
    message: "You're commenting a bit fast. Please try again in a few minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
