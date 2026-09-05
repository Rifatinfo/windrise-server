/**
 * Blog comments.
 *
 * Reading is open to everyone; writing requires an account. The commenter is
 * identified from their token, so the name and avatar shown come from the
 * account rather than anything the browser sent.
 */

import { BlogStatus, BlogVisibility, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";

import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";

const MAX_BODY = 2000;

/**
 * The post being commented on, if it is one the public can see.
 *
 * A draft or a private post must not accept comments — that would let someone
 * discover unpublished work by probing slugs and watching which ones accept a
 * reply.
 */
const requirePublicPost = async (slug: string) => {
  const post = await prisma.blogPost.findFirst({
    where: {
      slug,
      status: BlogStatus.PUBLISHED,
      visibility: BlogVisibility.PUBLIC,
    },
    select: { id: true },
  });

  if (!post) throw new ApiError(StatusCodes.NOT_FOUND, "Story not found");
  return post;
};

const commentInclude = {
  user: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.BlogCommentInclude;

type CommentRow = Prisma.BlogCommentGetPayload<{ include: typeof commentInclude }>;

/**
 * What a reader is allowed to see about a commenter.
 *
 * The email is stored but never leaves the server. Name and avatar are read
 * from the account, so a later profile change is reflected on old comments.
 */
const shapeComment = (row: CommentRow) => ({
  id: row.id,
  name: row.user?.name ?? row.name,
  avatar: row.user?.avatar ?? null,
  /** Always true now that commenting requires an account; kept for older rows. */
  isMember: Boolean(row.userId),
  body: row.body,
  createdAt: row.createdAt,
  parentId: row.parentId,
});

export type ShapedComment = ReturnType<typeof shapeComment> & {
  replies: ReturnType<typeof shapeComment>[];
};

/**
 * Comments for a story, newest first, each with its replies.
 *
 * `limit` applies to top-level comments; replies always travel with their
 * parent, because a thread split across pages reads as nonsense.
 */
export const listComments = async (
  slug: string,
  options: { page?: number; limit?: number } = {},
) => {
  const post = await requirePublicPost(slug);

  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(50, Math.max(1, options.limit ?? 3));

  const [roots, rootTotal, total] = await Promise.all([
    prisma.blogComment.findMany({
      where: { postId: post.id, parentId: null },
      include: { ...commentInclude, replies: { include: commentInclude, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.blogComment.count({ where: { postId: post.id, parentId: null } }),
    // Every comment, replies included — the heading counts the conversation,
    // not just its openings.
    prisma.blogComment.count({ where: { postId: post.id } }),
  ]);

  const data: ShapedComment[] = roots.map((root) => ({
    ...shapeComment(root),
    replies: root.replies.map(shapeComment),
  }));

  return { data, meta: { page, limit, total: rootTotal }, totalComments: total };
};

export type CreateCommentInput = {
  slug: string;
  body: string;
  parentId?: string | null;
};

export type CommentAuthor = { id: string; email?: string } | undefined;

export const createComment = async (
  input: CreateCommentInput,
  author: CommentAuthor,
) => {
  const post = await requirePublicPost(input.slug);

  const body = input.body.trim();
  if (!body) throw new ApiError(StatusCodes.BAD_REQUEST, "Write something first.");
  if (body.length > MAX_BODY) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "That comment is too long.");
  }

  /*
    Commenting requires an account. The route already enforces that, but the
    check is repeated here rather than assumed: this function is the thing that
    writes, and a guest branch left in place would be a second way in the day
    someone calls it from elsewhere.
  */
  if (!author?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Please sign in to comment.");
  }

  const user = await prisma.user.findUnique({
    where: { id: author.id },
    select: { name: true, email: true },
  });

  if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, "Your session has expired.");

  // Identity comes from the account, never the request body, so nobody can
  // post under another name while signed in.
  const name = user.name?.trim() || "Member";
  const email = user.email ?? author.email ?? "";

  let parentId: string | null = null;

  if (input.parentId) {
    const parent = await prisma.blogComment.findUnique({
      where: { id: input.parentId },
      select: { id: true, postId: true, parentId: true },
    });

    if (!parent || parent.postId !== post.id) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "That comment no longer exists.");
    }

    // Threads stay one level deep: replying to a reply attaches to the same
    // top-level comment rather than nesting further, which is what keeps the
    // conversation readable on a narrow screen.
    parentId = parent.parentId ?? parent.id;
  }

  const created = await prisma.blogComment.create({
    data: {
      postId: post.id,
      parentId,
      userId: author.id,
      name,
      email,
      body,
    },
    include: commentInclude,
  });

  return shapeComment(created);
};

export const CommentService = {
  listComments,
  createComment,
};
