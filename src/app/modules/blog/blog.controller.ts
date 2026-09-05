import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../errors/ApiError";
import { BlogService } from "./blog.service";

const ok = (res: Response, message: string, data: unknown, meta?: unknown) =>
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message,
    ...(meta ? { meta: meta as any } : {}),
    data,
  });

// ---------------------------------- Posts ----------------------------------

const listPosts = catchAsync(async (req: Request, res: Response) => {
  const result = await BlogService.listPosts(req.query as any);
  ok(res, "Posts fetched", result.data, result.meta);
});

const getPostStats = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Post stats fetched", await BlogService.getPostStats());
});

const getContentCounts = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Content counts fetched", await BlogService.getContentCounts());
});

const getPostById = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Post fetched", await BlogService.getPostById(req.params.id as string));
});

const createPost = catchAsync(async (req: Request, res: Response) => {
  const post = await BlogService.createPost(req.body);
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Post created",
    data: post,
  });
});

const updatePost = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Post updated", await BlogService.updatePost(req.params.id as string, req.body));
});

const deletePost = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Post deleted", await BlogService.deletePost(req.params.id as string));
});

const duplicatePost = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Post duplicated",
    data: await BlogService.duplicatePost(req.params.id as string),
  });
});

const bulkUpdateStatus = catchAsync(async (req: Request, res: Response) => {
  const { ids, status } = req.body;
  ok(res, "Posts updated", await BlogService.bulkUpdateStatus(ids, status));
});

const bulkDelete = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Posts deleted", await BlogService.bulkDelete(req.body.ids));
});

// -------------------------------- Taxonomy ---------------------------------

const listCategories = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Categories fetched", await BlogService.listCategories());
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Category created",
    data: await BlogService.createCategory(req.body),
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Category updated", await BlogService.updateCategory(req.params.id as string, req.body));
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Category deleted", await BlogService.deleteCategory(req.params.id as string));
});

const listTags = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Tags fetched", await BlogService.listTags());
});

const createTag = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Tag created",
    data: await BlogService.createTag(req.body),
  });
});

const deleteTag = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Tag deleted", await BlogService.deleteTag(req.params.id as string));
});

const listAuthors = catchAsync(async (_req: Request, res: Response) => {
  ok(res, "Authors fetched", await BlogService.listAuthors());
});

// ------------------------------- SEO & media -------------------------------

const seoSuggest = catchAsync(async (req: Request, res: Response) => {
  ok(res, "SEO fields drafted", await BlogService.seoSuggest(req.body));
});

const uploadImage = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, "No image uploaded");
  ok(res, "Image uploaded", await BlogService.uploadImage(req.file));
});

const uploadMedia = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw new ApiError(StatusCodes.BAD_REQUEST, "No file uploaded");
  ok(res, "File uploaded", await BlogService.uploadMedia(req.file));
});

// -------------------------------- Storefront -------------------------------

const listPublicPosts = catchAsync(async (req: Request, res: Response) => {
  const result = await BlogService.listPublicPosts(req.query as any);
  ok(res, "Posts fetched", result.data, result.meta);
});

const getPublicPost = catchAsync(async (req: Request, res: Response) => {
  ok(res, "Post fetched", await BlogService.getPublicPostBySlug(req.params.slug as string));
});

export const BlogController = {
  listPosts,
  getPostStats,
  getContentCounts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  duplicatePost,
  bulkUpdateStatus,
  bulkDelete,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listTags,
  createTag,
  deleteTag,
  listAuthors,
  seoSuggest,
  uploadImage,
  uploadMedia,
  listPublicPosts,
  getPublicPost,
};
