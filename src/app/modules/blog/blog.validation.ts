import { z } from "zod";

const nullableString = z.string().trim().nullable().optional();

const postBody = {
  title: z.string().trim().min(1, "Title is required").max(200),
  slug: nullableString,
  excerpt: z.string().trim().max(750).nullable().optional(),
  /** Optional pull-quote. Blank means the reader sees no highlight at all. */
  highlight: z.string().trim().max(500).nullable().optional(),
  content: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  featuredImage: nullableString,
  authorId: nullableString,
  customAuthorName: z.string().trim().max(120).nullable().optional(),
  customAuthorAvatar: nullableString,
  categoryId: nullableString,
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  metaTitle: z.string().trim().max(120).nullable().optional(),
  metaDescription: z.string().trim().max(320).nullable().optional(),
  focusKeyword: z.string().trim().max(120).nullable().optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  canonicalUrl: z.string().trim().url().nullable().optional().or(z.literal("")),
  isFeatured: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  showAds: z.boolean().optional(),
};

const createPostSchema = z.object(postBody);

/** Everything optional — the editor saves whichever fields changed. */
const updatePostSchema = z.object({
  ...postBody,
  title: postBody.title.optional(),
});

const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one post"),
  status: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one post"),
});

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z.string().trim().max(80).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().trim().max(80).optional(),
});

const tagSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});

const seoSuggestSchema = z.object({
  title: z.string().trim().min(1, "Add a title first"),
  excerpt: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
});

export const BlogValidation = {
  createPostSchema,
  updatePostSchema,
  bulkStatusSchema,
  bulkDeleteSchema,
  categorySchema,
  updateCategorySchema,
  tagSchema,
  seoSuggestSchema,
};
