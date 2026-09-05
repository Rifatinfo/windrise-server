import { commentRateLimiter } from "../../middlewares/rateLimiter";
import { CommentController } from "./comment.controller";
import { NextFunction, Request, Response, Router } from "express";
import { UserRole } from "@prisma/client";
import multer from "multer";

import auth from "../../middlewares/auth";
import { mediaMulterConfig, multerConfig } from "../../utils/fileUploader";
import { BlogController } from "./blog.controller";
import { BlogValidation } from "./blog.validation";

const router = Router();

const validate =
  (schema: (typeof BlogValidation)[keyof typeof BlogValidation]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };

/** Content is owned by admins and the media manager. */
const canManage = auth(UserRole.ADMIN, UserRole.MEDIA_MANAGER);
/** Shop managers can look but not touch. */
const canRead = auth(UserRole.ADMIN, UserRole.MEDIA_MANAGER, UserRole.SHOP_MANAGER);

// ---- Storefront: no auth, published posts only -----------------------------
router.get("/public/posts", BlogController.listPublicPosts);
router.get("/public/posts/:slug", BlogController.getPublicPost);

// Reading is public; writing requires an account. auth() with no roles means
// "any signed-in user" — a customer comments the same as anyone else.
router.get("/public/posts/:slug/comments", CommentController.listComments);
router.post(
  "/public/posts/:slug/comments",
  commentRateLimiter,
  auth(),
  CommentController.createComment,
);

// ---- Dashboard -------------------------------------------------------------
// Static segments are declared before "/posts/:id" so they are not swallowed.
router.get("/posts/stats", canRead, BlogController.getPostStats);
router.get("/content-counts", canRead, BlogController.getContentCounts);

router.get("/posts", canRead, BlogController.listPosts);
router.post(
  "/posts",
  canManage,
  validate(BlogValidation.createPostSchema),
  BlogController.createPost,
);

router.patch(
  "/posts/bulk/status",
  canManage,
  validate(BlogValidation.bulkStatusSchema),
  BlogController.bulkUpdateStatus,
);
router.post(
  "/posts/bulk/delete",
  canManage,
  validate(BlogValidation.bulkDeleteSchema),
  BlogController.bulkDelete,
);

router.get("/posts/:id", canRead, BlogController.getPostById);
router.patch(
  "/posts/:id",
  canManage,
  validate(BlogValidation.updatePostSchema),
  BlogController.updatePost,
);
router.delete("/posts/:id", canManage, BlogController.deletePost);
router.post("/posts/:id/duplicate", canManage, BlogController.duplicatePost);

// ---- Taxonomy --------------------------------------------------------------
router.get("/categories", canRead, BlogController.listCategories);
router.post(
  "/categories",
  canManage,
  validate(BlogValidation.categorySchema),
  BlogController.createCategory,
);
router.patch(
  "/categories/:id",
  canManage,
  validate(BlogValidation.updateCategorySchema),
  BlogController.updateCategory,
);
router.delete("/categories/:id", canManage, BlogController.deleteCategory);

router.get("/tags", canRead, BlogController.listTags);
router.post("/tags", canManage, validate(BlogValidation.tagSchema), BlogController.createTag);
router.delete("/tags/:id", canManage, BlogController.deleteTag);

router.get("/authors", canRead, BlogController.listAuthors);

// ---- SEO & media -----------------------------------------------------------
router.post(
  "/seo-suggest",
  canManage,
  validate(BlogValidation.seoSuggestSchema),
  BlogController.seoSuggest,
);

router.post(
  "/upload",
  canManage,
  multer(multerConfig).single("file"),
  BlogController.uploadImage,
);

// Post content can embed video, audio and documents, not just images.
router.post(
  "/upload-media",
  canManage,
  multer(mediaMulterConfig).single("file"),
  BlogController.uploadMedia,
);

export const BlogRoutes = router;
