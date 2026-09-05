import { z } from "zod";

export const updateUserSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(50, "Name must be at most 50 characters")
      .optional(),
    phone: z.string().optional(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  }),
});

export const getAllUsersSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "BANNED"]).optional(),
  }),
});
