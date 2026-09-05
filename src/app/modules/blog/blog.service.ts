import { StatusCodes } from "http-status-codes";
import { BlogStatus, Prisma } from "@prisma/client";
import slugify from "slugify";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { sanitizePostContent } from "../../../shared/sanitizeHtml";
import { optimizeAndSaveImage, saveRawFile } from "../../utils/imageOptimizer";
import { buildSeoChecks, computeSeoScore, countWords } from "./blog.seo";
import { suggestSeoFields, type SeoSuggestInput } from "./blog.ai";

const toSlug = (value: string) =>
  slugify(value, { lower: true, strict: true, trim: true });

/** Append -2, -3 … until the slug is free. `ignoreId` lets a post keep its own. */
const uniquePostSlug = async (base: string, ignoreId?: string) => {
  const root = toSlug(base) || "post";
  let candidate = root;
  let suffix = 1;

  while (true) {
    const clash = await prisma.blogPost.findFirst({
      where: { slug: candidate, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }
};

const POST_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
  author: { select: { id: true, name: true, email: true, avatar: true } },
} satisfies Prisma.BlogPostInclude;

type PostRow = Prisma.BlogPostGetPayload<{ include: typeof POST_INCLUDE }>;

/**
 * The author shown in the list and on the storefront: a linked staff account,
 * or the one-off name/photo typed into the editor.
 */
const shapeAuthor = (post: PostRow) => {
  if (post.customAuthorName) {
    return {
      id: null,
      name: post.customAuthorName,
      avatar: post.customAuthorAvatar,
      isCustom: true,
    };
  }
  if (post.author) {
    return {
      id: post.author.id,
      name: post.author.name ?? post.author.email ?? "Unknown",
      avatar: post.author.avatar,
      isCustom: false,
    };
  }
  return { id: null, name: "Unassigned", avatar: null, isCustom: false };
};

/**
 * The highlight is optional, and "optional" has to mean absent rather than
 * blank: an empty or whitespace-only value is stored as null so the reader is
 * never shown an empty highlight block.
 */
const normalizeHighlight = (value: string | null | undefined) =>
  value?.trim() ? value.trim() : null;

const shapePost = (post: PostRow) => ({
  id: post.id,
  title: post.title,
  slug: post.slug,
  excerpt: post.excerpt,
  highlight: post.highlight,
  content: post.content,
  status: post.status,
  visibility: post.visibility,
  publishedAt: post.publishedAt?.toISOString() ?? null,
  featuredImage: post.featuredImage,

  author: shapeAuthor(post),
  authorId: post.authorId,
  customAuthorName: post.customAuthorName,
  customAuthorAvatar: post.customAuthorAvatar,

  category: post.category,
  categoryId: post.categoryId,
  tags: post.tags,

  metaTitle: post.metaTitle,
  metaDescription: post.metaDescription,
  focusKeyword: post.focusKeyword,
  keywords: post.keywords,
  canonicalUrl: post.canonicalUrl,
  seoScore: post.seoScore,

  views: post.views,
  wordCount: countWords(post.content),
  isFeatured: post.isFeatured,
  allowComments: post.allowComments,
  showAds: post.showAds,

  createdAt: post.createdAt.toISOString(),
  updatedAt: post.updatedAt.toISOString(),
});

export type BlogPostPayload = {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  highlight?: string | null;
  content?: string | null;
  status?: BlogStatus;
  visibility?: "PUBLIC" | "PRIVATE";
  publishedAt?: string | null;
  featuredImage?: string | null;
  authorId?: string | null;
  customAuthorName?: string | null;
  customAuthorAvatar?: string | null;
  categoryId?: string | null;
  tags?: string[];
  metaTitle?: string | null;
  metaDescription?: string | null;
  focusKeyword?: string | null;
  keywords?: string[];
  canonicalUrl?: string | null;
  isFeatured?: boolean;
  allowComments?: boolean;
  showAds?: boolean;
};

/** Turn tag names into rows, reusing any that already exist. */
const connectTags = async (names?: string[]) => {
  if (!names || names.length === 0) return undefined;

  const unique = Array.from(
    new Map(
      names
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [name.toLowerCase(), name]),
    ).values(),
  );

  const ids: string[] = [];
  for (const name of unique) {
    const slug = toSlug(name);
    const tag = await prisma.blogTag.upsert({
      where: { slug },
      update: {},
      create: { name, slug },
      select: { id: true },
    });
    ids.push(tag.id);
  }

  return ids.map((id) => ({ id }));
};

/**
 * A post scheduled for a future date stays SCHEDULED; once that moment passes
 * it is simply published. Keeps the two statuses honest without a cron job.
 */
const resolveStatus = (
  status: BlogStatus | undefined,
  publishedAt: Date | null,
): BlogStatus => {
  if (!status) return BlogStatus.DRAFT;
  if (status === BlogStatus.PUBLISHED && publishedAt && publishedAt > new Date()) {
    return BlogStatus.SCHEDULED;
  }
  if (status === BlogStatus.SCHEDULED && publishedAt && publishedAt <= new Date()) {
    return BlogStatus.PUBLISHED;
  }
  return status;
};

const createPost = async (payload: BlogPostPayload) => {
  const slug = await uniquePostSlug(payload.slug || payload.title);
  const content = payload.content ? sanitizePostContent(payload.content) : null;
  const publishedAt = payload.publishedAt ? new Date(payload.publishedAt) : null;
  const status = resolveStatus(payload.status, publishedAt);

  const post = await prisma.blogPost.create({
    data: {
      title: payload.title,
      slug,
      excerpt: payload.excerpt ?? null,
      highlight: normalizeHighlight(payload.highlight),
      content,
      status,
      visibility: payload.visibility ?? "PUBLIC",
      // A published post with no date given goes live now.
      publishedAt:
        publishedAt ?? (status === BlogStatus.PUBLISHED ? new Date() : null),
      featuredImage: payload.featuredImage ?? null,
      authorId: payload.customAuthorName ? null : payload.authorId ?? null,
      customAuthorName: payload.customAuthorName ?? null,
      customAuthorAvatar: payload.customAuthorAvatar ?? null,
      categoryId: payload.categoryId ?? null,
      tags: { connect: await connectTags(payload.tags) },
      metaTitle: payload.metaTitle ?? null,
      metaDescription: payload.metaDescription ?? null,
      focusKeyword: payload.focusKeyword ?? null,
      keywords: payload.keywords ?? [],
      canonicalUrl: payload.canonicalUrl ?? null,
      seoScore: computeSeoScore({ ...payload, content }),
      isFeatured: payload.isFeatured ?? false,
      allowComments: payload.allowComments ?? true,
      showAds: payload.showAds ?? true,
    },
    include: POST_INCLUDE,
  });

  return shapePost(post);
};

const updatePost = async (id: string, payload: Partial<BlogPostPayload>) => {
  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Post not found");

  const content =
    payload.content !== undefined
      ? payload.content
        ? sanitizePostContent(payload.content)
        : null
      : existing.content;

  const publishedAt =
    payload.publishedAt !== undefined
      ? payload.publishedAt
        ? new Date(payload.publishedAt)
        : null
      : existing.publishedAt;

  const status = resolveStatus(payload.status ?? existing.status, publishedAt);

  const slug =
    payload.slug && toSlug(payload.slug) !== existing.slug
      ? await uniquePostSlug(payload.slug, id)
      : payload.title && !payload.slug && existing.title !== payload.title
        ? existing.slug // renaming a post keeps its permalink; edit it explicitly
        : existing.slug;

  const tagConnect = await connectTags(payload.tags);

  const post = await prisma.blogPost.update({
    where: { id },
    data: {
      ...(payload.title !== undefined && { title: payload.title }),
      slug,
      ...(payload.excerpt !== undefined && { excerpt: payload.excerpt }),
      ...(payload.highlight !== undefined && {
        highlight: normalizeHighlight(payload.highlight),
      }),
      ...(payload.content !== undefined && { content }),
      status,
      ...(payload.visibility !== undefined && { visibility: payload.visibility }),
      publishedAt:
        publishedAt ??
        (status === BlogStatus.PUBLISHED ? existing.publishedAt ?? new Date() : null),
      ...(payload.featuredImage !== undefined && {
        featuredImage: payload.featuredImage,
      }),
      ...(payload.customAuthorName !== undefined && {
        customAuthorName: payload.customAuthorName,
        // The two author modes are exclusive.
        authorId: payload.customAuthorName ? null : payload.authorId ?? existing.authorId,
      }),
      ...(payload.customAuthorName === undefined &&
        payload.authorId !== undefined && { authorId: payload.authorId }),
      ...(payload.customAuthorAvatar !== undefined && {
        customAuthorAvatar: payload.customAuthorAvatar,
      }),
      ...(payload.categoryId !== undefined && { categoryId: payload.categoryId }),
      ...(payload.tags !== undefined && {
        tags: { set: [], connect: tagConnect },
      }),
      ...(payload.metaTitle !== undefined && { metaTitle: payload.metaTitle }),
      ...(payload.metaDescription !== undefined && {
        metaDescription: payload.metaDescription,
      }),
      ...(payload.focusKeyword !== undefined && {
        focusKeyword: payload.focusKeyword,
      }),
      ...(payload.keywords !== undefined && { keywords: payload.keywords }),
      ...(payload.canonicalUrl !== undefined && {
        canonicalUrl: payload.canonicalUrl,
      }),
      ...(payload.isFeatured !== undefined && { isFeatured: payload.isFeatured }),
      ...(payload.allowComments !== undefined && {
        allowComments: payload.allowComments,
      }),
      ...(payload.showAds !== undefined && { showAds: payload.showAds }),
      seoScore: computeSeoScore({
        title: payload.title ?? existing.title,
        metaTitle: payload.metaTitle ?? existing.metaTitle,
        metaDescription: payload.metaDescription ?? existing.metaDescription,
        focusKeyword: payload.focusKeyword ?? existing.focusKeyword,
        content,
      }),
    },
    include: POST_INCLUDE,
  });

  return shapePost(post);
};

export type PostFilters = {
  searchTerm?: string;
  status?: string;
  categoryId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
};

const listPosts = async (filters: PostFilters) => {
  const page = Number(filters.page) > 0 ? Number(filters.page) : 1;
  const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 5;
  const skip = (page - 1) * limit;

  const where: Prisma.BlogPostWhereInput = {
    ...(filters.status && filters.status !== "ALL"
      ? { status: filters.status as BlogStatus }
      : {}),
    ...(filters.categoryId && filters.categoryId !== "ALL"
      ? { categoryId: filters.categoryId }
      : {}),
    ...(filters.searchTerm
      ? {
          OR: [
            { title: { contains: filters.searchTerm, mode: "insensitive" } },
            { slug: { contains: filters.searchTerm, mode: "insensitive" } },
            { excerpt: { contains: filters.searchTerm, mode: "insensitive" } },
            {
              customAuthorName: {
                contains: filters.searchTerm,
                mode: "insensitive",
              },
            },
            { author: { name: { contains: filters.searchTerm, mode: "insensitive" } } },
            { tags: { some: { name: { contains: filters.searchTerm, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const sortBy = filters.sortBy || "createdAt";
  const sortOrder = filters.sortOrder || "desc";

  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
    prisma.blogPost.count({ where }),
  ]);

  return { meta: { page, limit, total }, data: rows.map(shapePost) };
};

const getPostById = async (id: string) => {
  const post = await prisma.blogPost.findUnique({
    where: { id },
    include: POST_INCLUDE,
  });
  if (!post) throw new ApiError(StatusCodes.NOT_FOUND, "Post not found");
  return shapePost(post);
};

const deletePost = async (id: string) => {
  await prisma.blogPost.delete({ where: { id } }).catch(() => {
    throw new ApiError(StatusCodes.NOT_FOUND, "Post not found");
  });
  return { id };
};

/** Copy a post as a fresh draft, so an editor can iterate without risk. */
const duplicatePost = async (id: string) => {
  const source = await prisma.blogPost.findUnique({
    where: { id },
    include: { tags: { select: { id: true } } },
  });
  if (!source) throw new ApiError(StatusCodes.NOT_FOUND, "Post not found");

  const post = await prisma.blogPost.create({
    data: {
      title: `${source.title} (Copy)`,
      slug: await uniquePostSlug(`${source.title}-copy`),
      excerpt: source.excerpt,
      highlight: source.highlight,
      content: source.content,
      status: BlogStatus.DRAFT,
      visibility: source.visibility,
      publishedAt: null,
      featuredImage: source.featuredImage,
      authorId: source.authorId,
      customAuthorName: source.customAuthorName,
      customAuthorAvatar: source.customAuthorAvatar,
      categoryId: source.categoryId,
      tags: { connect: source.tags.map((tag) => ({ id: tag.id })) },
      metaTitle: source.metaTitle,
      metaDescription: source.metaDescription,
      focusKeyword: source.focusKeyword,
      keywords: source.keywords,
      canonicalUrl: null, // a copy must not claim the original's canonical URL
      seoScore: source.seoScore,
      isFeatured: false,
      allowComments: source.allowComments,
      showAds: source.showAds,
    },
    include: POST_INCLUDE,
  });

  return shapePost(post);
};

const bulkUpdateStatus = async (ids: string[], status: BlogStatus) => {
  const { count } = await prisma.blogPost.updateMany({
    where: { id: { in: ids } },
    data: {
      status,
      // Publishing in bulk has to give undated posts a date, or they would be
      // "published" but never appear in a date-ordered index.
      ...(status === BlogStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
    },
  });
  return { count };
};

const bulkDelete = async (ids: string[]) => {
  const { count } = await prisma.blogPost.deleteMany({
    where: { id: { in: ids } },
  });
  return { count };
};

const getPostStats = async () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [total, published, drafts, publishedThisMonth, views, seo, prevViews] =
    await Promise.all([
      prisma.blogPost.count(),
      prisma.blogPost.count({ where: { status: BlogStatus.PUBLISHED } }),
      prisma.blogPost.count({ where: { status: BlogStatus.DRAFT } }),
      prisma.blogPost.count({
        where: { status: BlogStatus.PUBLISHED, publishedAt: { gte: monthStart } },
      }),
      prisma.blogPost.aggregate({ _sum: { views: true } }),
      prisma.blogPost.aggregate({ _avg: { seoScore: true } }),
      prisma.blogPost.aggregate({
        _sum: { views: true },
        where: { publishedAt: { gte: prevMonthStart, lt: monthStart } },
      }),
    ]);

  const totalViews = views._sum.views ?? 0;
  const previousViews = prevViews._sum.views ?? 0;

  return {
    totalPosts: total,
    drafts,
    published,
    publishedThisMonth,
    totalViews,
    // Null rather than a fake 0% when there is no prior month to compare with.
    viewsChangePercent:
      previousViews > 0
        ? Math.round(((totalViews - previousViews) / previousViews) * 100)
        : null,
    avgSeoScore: Math.round(seo._avg.seoScore ?? 0),
  };
};

/** Badge counts for the sidebar's Content section. */
const getContentCounts = async () => {
  const [posts, ads] = await Promise.all([
    prisma.blogPost.count(),
    prisma.ad.count(),
  ]);
  return { posts, ads };
};

// ------------------------------- Categories --------------------------------

const listCategories = async () => {
  const rows = await prisma.blogCategory.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { posts: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    postCount: row._count.posts,
  }));
};

const createCategory = async (payload: { name: string; slug?: string }) => {
  const slug = toSlug(payload.slug || payload.name);
  const clash = await prisma.blogCategory.findFirst({
    where: { OR: [{ slug }, { name: payload.name }] },
  });
  if (clash) {
    throw new ApiError(StatusCodes.CONFLICT, "That category already exists");
  }
  return prisma.blogCategory.create({ data: { name: payload.name, slug } });
};

const updateCategory = async (
  id: string,
  payload: { name?: string; slug?: string },
) => {
  const existing = await prisma.blogCategory.findUnique({ where: { id } });
  if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Category not found");

  const slug = payload.slug ? toSlug(payload.slug) : existing.slug;
  const clash = await prisma.blogCategory.findFirst({
    where: {
      id: { not: id },
      OR: [{ slug }, ...(payload.name ? [{ name: payload.name }] : [])],
    },
  });
  if (clash) {
    throw new ApiError(StatusCodes.CONFLICT, "That category already exists");
  }

  return prisma.blogCategory.update({
    where: { id },
    data: { ...(payload.name && { name: payload.name }), slug },
  });
};

const deleteCategory = async (id: string) => {
  // Posts keep existing; the relation is optional and set to null.
  await prisma.blogCategory.delete({ where: { id } }).catch(() => {
    throw new ApiError(StatusCodes.NOT_FOUND, "Category not found");
  });
  return { id };
};

// ---------------------------------- Tags -----------------------------------

const listTags = async () => {
  const rows = await prisma.blogTag.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { posts: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    postCount: row._count.posts,
  }));
};

const createTag = async (payload: { name: string }) => {
  const slug = toSlug(payload.name);
  const existing = await prisma.blogTag.findUnique({ where: { slug } });
  if (existing) throw new ApiError(StatusCodes.CONFLICT, "That tag already exists");
  return prisma.blogTag.create({ data: { name: payload.name, slug } });
};

const deleteTag = async (id: string) => {
  await prisma.blogTag.delete({ where: { id } }).catch(() => {
    throw new ApiError(StatusCodes.NOT_FOUND, "Tag not found");
  });
  return { id };
};

// --------------------------------- Authors ---------------------------------

/** Staff accounts offered in the editor's author dropdown. */
const listAuthors = async () => {
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      role: { in: ["ADMIN", "SHOP_MANAGER", "MEDIA_MANAGER", "CUSTOMER_SUPPORT"] },
    },
    select: { id: true, name: true, email: true, avatar: true, role: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? row.email ?? "Unknown",
    email: row.email,
    avatar: row.avatar,
    role: row.role,
  }));
};

// -------------------------------- Uploads ----------------------------------

const uploadImage = async (file: Express.Multer.File) => {
  const filename = await optimizeAndSaveImage(file, "blog");
  return { url: `/uploads/blog/${filename}` };
};

/**
 * Upload for anything the post editor can embed. Images still go through
 * sharp (resized, re-encoded to webp); video, audio and documents are stored
 * as-is, since re-encoding them would be both lossy and pointless.
 */
const uploadMedia = async (file: Express.Multer.File) => {
  const isImage = file.mimetype.startsWith("image/");
  const folder = isImage ? "blog" : "blog/media";

  const filename = isImage
    ? await optimizeAndSaveImage(file, folder)
    : await saveRawFile(file, folder);

  return {
    url: `/uploads/${folder}/${filename}`,
    name: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
};

// ------------------------------- SEO helpers -------------------------------

const seoSuggest = async (input: SeoSuggestInput) => suggestSeoFields(input);

const seoPreview = (input: Parameters<typeof buildSeoChecks>[0]) => ({
  score: computeSeoScore(input),
  checks: buildSeoChecks(input),
  wordCount: countWords(input.content),
});

// --------------------------- Storefront (public) ---------------------------

const listPublicPosts = async (filters: {
  categorySlug?: string;
  tagSlug?: string;
  page?: number;
  limit?: number;
  /** "popular" powers the Popular Posts rail; anything else is newest first. */
  sort?: string;
  /** Slug to leave out — the post already on screen. */
  excludeSlug?: string;
}) => {
  const page = Number(filters.page) > 0 ? Number(filters.page) : 1;
  const limit = Number(filters.limit) > 0 ? Number(filters.limit) : 9;

  const where: Prisma.BlogPostWhereInput = {
    status: BlogStatus.PUBLISHED,
    visibility: "PUBLIC",
    publishedAt: { lte: new Date() },
    ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
    ...(filters.tagSlug ? { tags: { some: { slug: filters.tagSlug } } } : {}),
    ...(filters.excludeSlug ? { slug: { not: filters.excludeSlug } } : {}),
  };

  const orderBy: Prisma.BlogPostOrderByWithRelationInput[] =
    filters.sort === "popular"
      ? [{ views: "desc" }, { publishedAt: "desc" }]
      : [{ publishedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      include: POST_INCLUDE,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.blogPost.count({ where }),
  ]);

  return { meta: { page, limit, total }, data: rows.map(shapePost) };
};

const getPublicPostBySlug = async (slug: string) => {
  const post = await prisma.blogPost.findFirst({
    where: {
      slug,
      status: BlogStatus.PUBLISHED,
      visibility: "PUBLIC",
      publishedAt: { lte: new Date() },
    },
    include: POST_INCLUDE,
  });
  if (!post) throw new ApiError(StatusCodes.NOT_FOUND, "Post not found");

  // Fire and forget: a failed counter must never break the page.
  prisma.blogPost
    .update({ where: { id: post.id }, data: { views: { increment: 1 } } })
    .catch(() => undefined);

  // The "Next" link at the foot of a post: the one published just before it,
  // so readers move backwards through the archive rather than hitting a wall.
  const next = await prisma.blogPost.findFirst({
    where: {
      status: BlogStatus.PUBLISHED,
      visibility: "PUBLIC",
      publishedAt: { lt: post.publishedAt ?? new Date() },
      id: { not: post.id },
    },
    orderBy: { publishedAt: "desc" },
    select: { title: true, slug: true },
  });

  return { ...shapePost(post), next };
};

export const BlogService = {
  createPost,
  updatePost,
  listPosts,
  getPostById,
  deletePost,
  duplicatePost,
  bulkUpdateStatus,
  bulkDelete,
  getPostStats,
  getContentCounts,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listTags,
  createTag,
  deleteTag,
  listAuthors,
  uploadImage,
  uploadMedia,
  seoSuggest,
  seoPreview,
  listPublicPosts,
  getPublicPostBySlug,
};
