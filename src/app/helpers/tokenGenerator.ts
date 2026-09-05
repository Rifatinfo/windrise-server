import crypto from "crypto";

export const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString("hex");
};

export const generateOtp = (length: number = 6): string => {
  return crypto.randomInt(10 ** (length - 1), 10 ** length).toString();
};
