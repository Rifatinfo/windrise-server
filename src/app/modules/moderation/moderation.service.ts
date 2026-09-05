/**
 * Comment moderation.
 *
 * One list over two different things — product reviews and blog comments — so
 * an admin has a single place to read everything customers have written and
 * remove anything that should not stand.
 *
 * Nothing here approves: both kinds publish the moment they are written, by
 * design. This is after-the-fact control, not a queue.
 */

import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";

export type CommentSource = "PRODUCT" | "BLOG";

export type ModerationComment = {
  id: string;
  source: CommentSource;
  author: {
    name: string;
    /** Phone for a reviewer, email for a blog commenter — how to reach them. */
    contact: string | null;
    /** Written while signed in, so it is tied to a real account. */
    isMember: boolean;
    avatar: string | null;
  };
  body: string;
  /** Product reviews only. */
  rating: number | null;
  images: string[];
  /** What was commented on, and where to go and see it. */
  target: { title: string; href: string };
  /** Blog only: a reply under another comment. */
  isReply: boolean;
  /** Blog only: how many replies would go with it if deleted. */
  replyCount: number;
  createdAt: Date;
};

const productHref = (
  categoryName: string | undefined,
  subCategoryName: string | undefined,
  slug: string,
) => {
  if (!categoryName) return "#";
  const middle = subCategoryName ? encodeURIComponent(subCategoryName) : "product";
  return `/${encodeURIComponent(categoryName)}/${middle}/${encodeURIComponent(slug)}`;
};

const reviewInclude = {
  product: {
    select: {
      name: true,
      slug: true,
      categories: { take: 1, include: { category: { select: { name: true } } } },
      subCategories: { take: 1, include: { subCategory: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ProductReviewInclude;

const commentInclude = {
  post: { select: { title: true, slug: true } },
  user: { select: { name: true, avatar: true } },
  _count: { select: { replies: true } },
} satisfies Prisma.BlogCommentInclude;

const shapeReview = (
  row: Prisma.ProductReviewGetPayload<{ include: typeof reviewInclude }>,
): ModerationComment => ({
  id: row.id,
  source: "PRODUCT",
  author: {
    // The stored name, not the masked one the storefront shows: an admin
    // moderating needs to know who actually wrote this.
    name: row.name,
    contact: row.phone,
    isMember: false,
    avatar: null,
  },
  body: row.body,
  rating: row.rating,
  images: row.images,
  target: {
    title: row.product.name,
    href: productHref(
      row.product.categories[0]?.category?.name,
      row.product.subCategories[0]?.subCategory?.name,
      row.product.slug,
    ),
  },
  isReply: false,
  replyCount: 0,
  createdAt: row.createdAt,
});

const shapeComment = (
  row: Prisma.BlogCommentGetPayload<{ include: typeof commentInclude }>,
): ModerationComment => ({
  id: row.id,
  source: "BLOG",
  author: {
    name: row.user?.name ?? row.name,
    contact: row.email || null,
    isMember: Boolean(row.userId),
    avatar: row.user?.avatar ?? null,
  },
  body: row.body,
  rating: null,
  images: [],
  target: { title: row.post.title, href: `/blog/${row.post.slug}` },
  isReply: Boolean(row.parentId),
  replyCount: row._count.replies,
  createdAt: row.createdAt,
});

export type ListOptions = {
  source?: CommentSource;
  search?: string;
  page?: number;
  limit?: number;
};

/**
 * A single page across both tables.
 *
 * Ordering has to be global — the newest comment overall, whichever table it
 * came from — so the page is chosen by a UNION over just the ids and dates,
 * then the rows for that page are loaded with their relations. Paging each
 * table separately and stitching the halves together would silently drop
 * whichever side had more traffic.
 */
export const listComments = async (options: ListOptions = {}) => {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = (page - 1) * limit;

  const term = options.search?.trim() ?? "";
  const like = `%${term}%`;
  const wantsProduct = options.source !== "BLOG";
  const wantsBlog = options.source !== "PRODUCT";

  const rows = await prisma.$queryRaw<Array<{ id: string; source: string; createdat: Date }>>`
    SELECT id, source, "createdAt" AS createdat FROM (
      SELECT r.id, 'PRODUCT' AS source, r."createdAt"
      FROM product_reviews r
      JOIN products p ON p.id = r."productId"
      WHERE ${wantsProduct}
        AND (${term} = '' OR r.body ILIKE ${like} OR r.name ILIKE ${like} OR p.name ILIKE ${like})

      UNION ALL

      SELECT c.id, 'BLOG' AS source, c."createdAt"
      FROM blog_comments c
      JOIN blog_posts b ON b.id = c."postId"
      WHERE ${wantsBlog}
        AND (${term} = '' OR c.body ILIKE ${like} OR c.name ILIKE ${like} OR b.title ILIKE ${like})
    ) AS merged
    ORDER BY "createdAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const totals = await prisma.$queryRaw<Array<{ source: string; total: bigint }>>`
    SELECT 'PRODUCT' AS source, COUNT(*)::bigint AS total
    FROM product_reviews r JOIN products p ON p.id = r."productId"
    WHERE ${term} = '' OR r.body ILIKE ${like} OR r.name ILIKE ${like} OR p.name ILIKE ${like}
    UNION ALL
    SELECT 'BLOG' AS source, COUNT(*)::bigint AS total
    FROM blog_comments c JOIN blog_posts b ON b.id = c."postId"
    WHERE ${term} = '' OR c.body ILIKE ${like} OR c.name ILIKE ${like} OR b.title ILIKE ${like}
  `;

  const reviewIds = rows.filter((r) => r.source === "PRODUCT").map((r) => r.id);
  const commentIds = rows.filter((r) => r.source === "BLOG").map((r) => r.id);

  const [reviews, comments] = await Promise.all([
    reviewIds.length
      ? prisma.productReview.findMany({ where: { id: { in: reviewIds } }, include: reviewInclude })
      : Promise.resolve([]),
    commentIds.length
      ? prisma.blogComment.findMany({ where: { id: { in: commentIds } }, include: commentInclude })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, ModerationComment>();
  reviews.forEach((r) => byId.set(r.id, shapeReview(r)));
  comments.forEach((c) => byId.set(c.id, shapeComment(c)));

  // Back into the order the UNION decided.
  const data = rows.map((r) => byId.get(r.id)).filter(Boolean) as ModerationComment[];

  const count = (source: string) =>
    Number(totals.find((t) => t.source === source)?.total ?? 0);

  const productTotal = count("PRODUCT");
  const blogTotal = count("BLOG");
  const total =
    options.source === "PRODUCT"
      ? productTotal
      : options.source === "BLOG"
        ? blogTotal
        : productTotal + blogTotal;

  return {
    data,
    counts: { product: productTotal, blog: blogTotal, all: productTotal + blogTotal },
    meta: { page, limit, total },
  };
};

/**
 * Removes one comment.
 *
 * A blog comment's replies are cascaded away with it by the schema, so the
 * count is reported back — deleting a thread's opening line takes the whole
 * thread, and the admin should be told that rather than discover it.
 */
export const deleteComment = async (source: CommentSource, id: string) => {
  if (source === "PRODUCT") {
    const review = await prisma.productReview.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!review) throw new ApiError(StatusCodes.NOT_FOUND, "Review not found");

    await prisma.productReview.delete({ where: { id } });
    return { deleted: 1, source };
  }

  const comment = await prisma.blogComment.findUnique({
    where: { id },
    select: { id: true, _count: { select: { replies: true } } },
  });
  if (!comment) throw new ApiError(StatusCodes.NOT_FOUND, "Comment not found");

  await prisma.blogComment.delete({ where: { id } });
  return { deleted: 1 + comment._count.replies, source };
};

export const ModerationService = { listComments, deleteComment };
