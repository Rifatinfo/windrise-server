export {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.validator";

export {
  createPostSchema,
  updatePostSchema,
  getPostSchema,
  deletePostSchema,
  getAllPostsSchema,
} from "./post.validator";

export { updateUserSchema, getAllUsersSchema } from "./user.validator";
