import { z } from "zod";

const eligibilitySchema = z.object({
  productId: z.string().min(1),
  phone: z.string().min(6).max(30),
});

const submitSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1, "Your name is required.").max(80),
  phone: z.string().min(6).max(30),
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().min(1, "Please write your review.").max(2000),
  // Paths returned by the upload endpoint, never arbitrary URLs — a review is
  // public, so an off-site src would let a submission embed someone else's
  // host in the product page.
  images: z
    .array(z.string().regex(/^\/uploads\/reviews\/[\w.-]+$/, "Unexpected image path"))
    .max(5)
    .optional(),
});

/** Query parameters arrive as strings, so the numbers are coerced here. */
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const ReviewValidation = {
  eligibilitySchema,
  submitSchema,
  listQuerySchema,
};
