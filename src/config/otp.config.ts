/** Roles that must clear an emailed one-time code before a session is issued. */
export const OTP_REQUIRED_ROLES = [
  "ADMIN",
  "SHOP_MANAGER",
  "MEDIA_MANAGER",
  "CUSTOMER_SUPPORT",
] as const;

/** How long a code is accepted for. */
export const OTP_VALID_MINUTES = 2;

/**
 * How long the row survives before it is deleted. Longer than the validity
 * window so an expired-but-not-yet-purged code can still be told apart from
 * one that never existed, which makes "your code expired, resend it" possible.
 */
export const OTP_PURGE_MINUTES = 5;

/** Wrong guesses allowed before the code is burned and a new one is needed. */
export const OTP_MAX_ATTEMPTS = 5;

/** Length of the numeric code. */
export const OTP_LENGTH = 6;

/** A shopper may not request a fresh code faster than this. */
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
