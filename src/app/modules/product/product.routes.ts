import { Router } from "express";

import { ProductController } from "./product.controller";
import { createProductSchema, updateProductSchema } from "./product.validation";
import multer from "multer";
import { multerConfig } from "../../../app/utils/fileUploader";

const router = Router();
const productUpload = multer(multerConfig).fields([
  { name: "thumbnailImage", maxCount: 1 },
  { name: "sizeGuidImage", maxCount: 1 },
  { name: "file", maxCount: 16 }, // gallery images
]);
router.post(
  "/create",
  (req, res, next) => {
    productUpload(req, res, (err) => {
      if (err) return next(err);

      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      (req as any).thumbnailImage = files["thumbnailImage"]?.[0];
      (req as any).sizeGuidImage = files["sizeGuidImage"]?.[0];
      (req as any).galleryFiles = files["file"] || [];

      next();
    });
  },
  (req, _res, next) => {
    try {
      if (!req.body?.data) {
        throw new Error("Product data missing");
      }

      const parsed = JSON.parse(req.body.data);
      req.body = createProductSchema.parse(parsed);

      next();
    } catch (error) {
      next(error);
    }
  },
  ProductController.createProduct
);
router.get("/", ProductController.getAllProduct);
router.get("/slug/:slug", ProductController.getProductBySlug);

// Storefront search: the overlay typeahead and the /search results page.
router.get("/search/suggest", ProductController.suggestProducts);
router.get("/search", ProductController.searchProducts);
router.delete("/:productId", ProductController.deleteProduct);
router.patch("/:slug", 
  (req, res, next) => {
    productUpload(req, res, (err) => {
      if(err) return next(err);

      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      }

      (req as any).thumbnailImage = files?.["thumbnailImage"]?.[0];
      (req as any).sizeGuidImage = files?.["sizeGuidImage"]?.[0];
      (req as any).galleryFiles = files?.["file"] || [];

      next();
    })
  },
  (req, _res, next) => {
    try {
      if(req.body?.data){
         const parsed = JSON.parse(req.body.data);
         req.body = updateProductSchema.parse(parsed);
      }
      next();
    }catch(error) {
      next(error);
    }
  },
  ProductController.updateProduct
);

//=============== category and subcategory ======================// 

router.post("/create-category", ProductController.createCategory);
router.get("/category", ProductController.getAllCategories);
router.delete("/category/:id", ProductController.deleteCategory);
router.post("/create-sub-category", ProductController.createSubCategory);
router.get("/sub-category", ProductController.getAllSubCategories);
router.delete("/sub-category/:id", ProductController.deleteSubCategory);

//===================== Best selling ============================// 
// router.get("/best-selling", ProductController.getBestSellingProducts);
//====================== New arival =============================// 
router.get("/new-arrivals", ProductController.getNewArrivalProducts);
router.get("/related-products/:productId",ProductController.getRelatedProducts);
router.post("/ai-conversation-chatbot", ProductController.getAISuggestion);

export const ProductRoutes = router;