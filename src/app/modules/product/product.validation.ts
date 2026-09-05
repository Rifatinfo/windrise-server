
import { z } from 'zod';
import { hasMeaningfulHtmlContent, sanitizeProductDescription } from '../../../shared/sanitizeHtml';

const fullDescriptionField = z
    .string()
    .refine(hasMeaningfulHtmlContent, {
        message: "Product description is required.",
    })
    .transform(sanitizeProductDescription);

export const createProductSchema = z.object({
    name: z.string().min(1),
    slug: z.string().optional(),
    sku: z.string().min(1),
    regularPrice: z.number().min(0),
    salePrice: z.number().optional(),
    stockQuantity: z.number().min(0).optional(),
    stockStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "LOW_STOCK"]),
    shortDescription: z.string().optional(),
    fullDescription: fullDescriptionField,
    categories: z.array(z.string()).min(1), // category IDs
    subCategories: z.array(z.string()).optional(), // subcategory IDs
    variants: z
        .array(
            z.object({
                color: z.string().optional(),
                size: z.string().optional(),
                quantity: z.number().int().min(0),
                sku: z.string().optional()
            })
        )
        .optional(),
    sizeGuidImage: z.string().optional(),
    thumbnailImage: z.string().optional(),
    images: z.array(z.string()).optional(), // image URLs
    tags: z.array(z.string()).optional(),
    additionalInformation: z
        .array(
            z.object({
                label: z.string(),
                value: z.string(),
            })
        )
        .optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  sku: z.string().min(1).optional(),
  regularPrice: z.number().min(0).optional(),
  salePrice: z.number().optional(),
  stockQuantity: z.number().min(0).optional(),
  stockStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "LOW_STOCK"]).optional(),
  shortDescription: z.string().optional(),
  fullDescription: fullDescriptionField.optional(),
  categories: z.array(z.string()).min(1).optional(), // category IDs
  subCategories: z.array(z.string()).optional(), // subcategory IDs
  variants: z
    .array(
      z.object({
        color: z.string().optional(),
        size: z.string().optional(),
        quantity: z.number().int().min(0).optional(),
        sku: z.string().optional(),
      })
    )
    .optional(),
  sizeGuidImage: z.string().optional(),
  thumbnailImage: z.string().optional(),
  images: z.array(z.string()).optional(), // image URLs
  tags: z.array(z.string()).optional(),
  additionalInformation: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
      })
    )
    .optional(),
  existingGalleryImages: z.array(z.string()).optional(),
  existingThumbnail: z.string().optional(),
  existingSizeGuide: z.string().optional(),
  removeThumbnail: z.boolean().optional(),
  removeSizeGuide: z.boolean().optional(),
});
export const ProductSchema = {
  createProductSchema,
  updateProductSchema,
};

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;