import dotenv from "dotenv";

dotenv.config();

interface EnvConfig {
  PORT: string;
  DATABASE_URL: string;
  NODE_ENV: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  BCRYPT_SALT_ROUNDS: string;
  REFRESH_TOKEN_SECRET: string;
  REFRESH_TOKEN_EXPIRES_IN: string;
  JWT_SECRET_EXPIRES_IN: string;
  RESET_PASS_LINK: string;
  RESET_PASS_SECRET: string;
  RESET_PASS_TOKEN_EXPIRES_IN: string;
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  // newly added
  BACKEND_URL: string;
  SSL_STORE_ID: string;
  SSL_STORE_PASS: string;
  SSL_PAYMENT_API: string;
  SSL_VALIDATION_API: string;
  SSL_SUCCESS_BACKEND_URL: string;
  SSL_FAIL_BACKEND_URL: string;
  SSL_CANCEL_BACKEND_URL: string;
  SSL_SUCCESS_FRONTEND_URL: string;
  SSL_FAIL_FRONTEND_URL: string;
  SSL_CANCEL_FRONTEND_URL: string;
  SSL_IPN_URL: string;
  ROUTER_API_KEY: string;
  ACCESS_TOKEN_EXPIRY  : string;
  REFRESH_TOKEN_EXPIRY : string;
  GOOGLE_CLIENT_SECRET : string;
  GOOGLE_CLIENT_ID :  string;
  GOOGLE_CALLBACK_URL : string;

  // ---- Meta / Messenger --------------------------------------------------
  // Deliberately optional: the support inbox has to boot and serve the Windee
  // channel on a machine that has no Page credentials. Messenger endpoints
  // check for what they need and fail with a clear message instead.
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_PAGE_ID?: string;
  META_PAGE_ACCESS_TOKEN?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_WEBHOOK_URL?: string;
  META_GRAPH_API_VERSION?: string;
}

const loadEnvVariable = (): EnvConfig => {
  const requiredEnvVariable: string[] = [
    "PORT",
    "DATABASE_URL",
    "NODE_ENV",
    "JWT_SECRET",
    "FRONTEND_URL",
    "BCRYPT_SALT_ROUNDS",
    "REFRESH_TOKEN_SECRET",
    "REFRESH_TOKEN_EXPIRES_IN",
    "JWT_SECRET_EXPIRES_IN",
    "RESET_PASS_LINK",
    "RESET_PASS_SECRET",
    "RESET_PASS_TOKEN_EXPIRES_IN",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "BACKEND_URL",
    "SSL_STORE_ID",
    "SSL_STORE_PASS",
    "SSL_PAYMENT_API",
    "SSL_VALIDATION_API",
    "SSL_SUCCESS_BACKEND_URL",
    "SSL_FAIL_BACKEND_URL",
    "SSL_CANCEL_BACKEND_URL",
    "SSL_SUCCESS_FRONTEND_URL",
    "SSL_FAIL_FRONTEND_URL",
    "SSL_CANCEL_FRONTEND_URL",
    "SSL_IPN_URL",
    "ROUTER_API_KEY",
    "ACCESS_TOKEN_EXPIRY",
    "REFRESH_TOKEN_EXPIRY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL"
  ];

  requiredEnvVariable.forEach((key) => {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable ${key}`);
    }
  });

  return {
    PORT: process.env.PORT as string,
    DATABASE_URL: process.env.DATABASE_URL as string,
    NODE_ENV: process.env.NODE_ENV as string,
    JWT_SECRET: process.env.JWT_SECRET as string,
    FRONTEND_URL: process.env.FRONTEND_URL as string,
    BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS as string,
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET as string,
    REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN as string,
    JWT_SECRET_EXPIRES_IN: process.env.JWT_SECRET_EXPIRES_IN as string,
    RESET_PASS_LINK: process.env.RESET_PASS_LINK as string,
    RESET_PASS_SECRET: process.env.RESET_PASS_SECRET as string,
    RESET_PASS_TOKEN_EXPIRES_IN: process.env.RESET_PASS_TOKEN_EXPIRES_IN as string,
    SMTP_HOST: process.env.SMTP_HOST as string,
    SMTP_PORT: process.env.SMTP_PORT as string,
    SMTP_USER: process.env.SMTP_USER as string,
    SMTP_PASS: process.env.SMTP_PASS as string,
    SMTP_FROM: process.env.SMTP_FROM as string,
    ROUTER_API_KEY : process.env.ROUTER_API_KEY as string,
    BACKEND_URL: process.env.BACKEND_URL as string,
    SSL_STORE_ID: process.env.SSL_STORE_ID as string,
    SSL_STORE_PASS: process.env.SSL_STORE_PASS as string,
    SSL_PAYMENT_API: process.env.SSL_PAYMENT_API as string,
    SSL_VALIDATION_API: process.env.SSL_VALIDATION_API as string,
    SSL_SUCCESS_BACKEND_URL: process.env.SSL_SUCCESS_BACKEND_URL as string,
    SSL_FAIL_BACKEND_URL: process.env.SSL_FAIL_BACKEND_URL as string,
    SSL_CANCEL_BACKEND_URL: process.env.SSL_CANCEL_BACKEND_URL as string,
    SSL_SUCCESS_FRONTEND_URL: process.env.SSL_SUCCESS_FRONTEND_URL as string,
    SSL_FAIL_FRONTEND_URL: process.env.SSL_FAIL_FRONTEND_URL as string,
    SSL_CANCEL_FRONTEND_URL: process.env.SSL_CANCEL_FRONTEND_URL as string,
    SSL_IPN_URL: process.env.SSL_IPN_URL as string,
    ACCESS_TOKEN_EXPIRY : process.env.ACCESS_TOKEN_EXPIRY as  string,
    REFRESH_TOKEN_EXPIRY : process.env.REFRESH_TOKEN_EXPIRY as  string,
    GOOGLE_CLIENT_SECRET  : process.env.GOOGLE_CLIENT_SECRET as  string,
    GOOGLE_CLIENT_ID : process.env.GOOGLE_CLIENT_ID as string,
    GOOGLE_CALLBACK_URL : process.env.GOOGLE_CALLBACK_URL as string,

    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_PAGE_ID: process.env.META_PAGE_ID,
    META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN,
    META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN,
    META_WEBHOOK_URL: process.env.META_WEBHOOK_URL,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION ?? "v21.0",
  };
};

export const envVars = loadEnvVariable();