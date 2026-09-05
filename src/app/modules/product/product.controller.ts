import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import { Request, Response } from "express";
import sendResponse from "../../../shared/sendResponse";

import pick from "../../../shared/pick";
import { productFilterableFields } from "./product.constant";
import prisma from "../../../shared/prisma";
import ApiError from "../../errors/ApiError";
import { ProductService } from "./product.service";

const createProduct = catchAsync(async (req: Request, res: Response) => {
  const product = await ProductService.createProduct(
    req as Request & { files?: Express.Multer.File[] },
  );
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Product created successfully",
    data: product,
  });
});

const getAllProduct = catchAsync(async (req: Request, res: Response) => {
  //================= searching , filtering ================//
  const filters = pick(req.query, productFilterableFields);
  // ================= pagination and sorting =================//
  const options = pick(req.query, ["page", "limit", "sortBy", "sortOrder"]);
  const products = await ProductService.getProducts(filters, options);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Products retrieved successfully",
    meta: products.meta,
    data: products.data,
  });
});

const getProductBySlug = catchAsync(async (req: Request, res: Response) => {
  const { slug } = req.params;

  const product = await ProductService.getProductBySlug(slug as string);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product fetched successfully",
    data: product,
  });
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
  const { productId } = req.params;
  await ProductService.deleteProduct(productId as string);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product deleted successfully",
    data: null,
  });
});

const updateProduct = catchAsync(async (req: Request, res: Response) => {
  const { slug } = req.params;

  const result = await ProductService.updateProduct(
    slug as string,
    req as Request & { files?: Express.Multer.File[] },
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product updated successfully",
    data: result,
  });
});

// ====================== category ==================//
const createCategory = catchAsync(async (req: Request, res: Response) => {
  const { name } = req.body;
  const category = await prisma.category.create({
    data: { name },
  });
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product createCategory successfully",
    data: category,
  });
});

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
  const categories = await prisma.category.findMany();
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product getAllCategories successfully",
    data: categories,
  });
});

const createSubCategory = catchAsync(async (req: Request, res: Response) => {
  const { name } = req.body;

  const sub = await prisma.subCategory.create({
    data: { name },
  });
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product createSubCategory successfully",
    data: sub,
  });
});

//==============  GET ALL SUBCATEGORY ===================//
const getAllSubCategories = catchAsync(async (req: Request, res: Response) => {
  const sub = await prisma.subCategory.findMany();
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product getAllSubCategories successfully",
    data: sub,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.category.delete({
    where: { id: id as string },
  });
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product Category deleted successfully",
    data: null,
  });
});
const deleteSubCategory = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.subCategory.delete({
    where: { id: id as string },
  });
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Product SubCategory deleted successfully",
    data: null,
  });
});

//======================= New Controller: Get Best Selling Products  ==========================//

// const getBestSellingProducts = catchAsync(
//   async (req: Request, res: Response) => {
//     const result = await ProductService.getBestSellingProducts();

//     res.status(200).json({
//       success: true,
//       message: "Best selling products retrieved successfully",
//       data: result,
//     });
//   },
// );

const getNewArrivalProducts = catchAsync(
  async (req: Request, res: Response) => {
    const result = await ProductService.getNewArrivalProducts();

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "New arrival products retrieved successfully",
      data: result,
    });
  },
);

const getRelatedProducts = catchAsync(async (req: Request, res: Response) => {
  const { productId } = req.params;

  // How many cards the caller's layout has room for. Anything unparseable
  // falls through to the service's own default rather than becoming NaN.
  const parsedLimit = Number.parseInt(String(req.query.limit ?? ""), 10);

  const result = await ProductService.getRelatedProducts(
    productId as string,
    Number.isFinite(parsedLimit) ? parsedLimit : undefined,
  );
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Related products retrieved successfully",
    data: result,
  });
});


const searchProducts = catchAsync(async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const options = pick(req.query, ["page", "limit", "sortBy", "sortOrder"]);

  const filters = pick(req.query, ["sale"]);

  const result = await ProductService.searchProducts(query, options, filters);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Search results retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const suggestProducts = catchAsync(async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Number(req.query.limit) || 6;

  const result = await ProductService.suggestProducts(query, limit);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Suggestions retrieved successfully",
    meta: { page: 1, limit, total: result.total },
    data: result.data,
  });
});
const getAISuggestion = catchAsync(async (req: Request, res: Response) => {
    const { searchIntent, history } = req.body;

    if (!searchIntent) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "searchIntent is required");
    }

    const result = await ProductService.getAISuggestion(
        searchIntent,
        history || []
    );

    res.status(200).json({
        success: true,
        message: "AI Suggestion fetched successfully",
        data: result,
    });
});

export const ProductController = {
  createProduct,
  getAllProduct,
  getProductBySlug,
  deleteProduct,
  updateProduct,
  createCategory,
  getAllCategories,
  createSubCategory,
  getAllSubCategories,
  deleteCategory,
  deleteSubCategory,
  getNewArrivalProducts,
  getRelatedProducts,
  searchProducts,
  suggestProducts,
  getAISuggestion
};