import { AuthService } from "../modules/auth/auth.service";

const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Deletes sign-in codes once their 5-minute lifetime is up.
 *
 * Every OTP operation already purges opportunistically, so this only matters
 * for codes belonging to sign-ins that were simply abandoned — without it they
 * would sit in the table until that user next tried to log in.
 */
export const startOtpCleanup = () => {
  const sweep = async () => {
    try {
      const removed = await AuthService.purgeExpiredOtps();
      if (removed > 0) {
        console.log(`🧹 Purged ${removed} expired sign-in code(s)`);
      }
    } catch (error) {
      console.error("Failed to purge expired sign-in codes:", error);
    }
  };

  void sweep();

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Never hold the process open just for the sweep.
  timer.unref?.();
  return timer;
};
