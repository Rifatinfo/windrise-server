import { z } from "zod";

export const createPostSchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(3, "Title must be at least 3 characters")
      .max(200, "Title must be at most 200 characters"),
    content: z.string().min(10, "Content must be at least 10 characters"),
    published: z.boolean().optional().default(false),
  }),
});

export const updatePostSchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(3, "Title must be at least 3 characters")
      .max(200, "Title must be at most 200 characters")
      .optional(),
    content: z
      .string()
      .min(10, "Content must be at least 10 characters")
      .optional(),
    published: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().uuid("Invalid post ID"),
  }),
});

export const getPostSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid post ID"),
  }),
});

export const deletePostSchema = z.object({
  params: z.object({
    id: z.string().uuid("Invalid post ID"),
  }),
});

export const getAllPostsSchema = z.object({
  query: z.object({
    search: z.string().optional(),
    published: z.string().optional(),
  }),
});
