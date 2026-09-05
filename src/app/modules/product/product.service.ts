import { Prisma } from "@prisma/client";
import path from "path";
import fs from "fs/promises";

import prisma from "../../../shared/prisma";


import { CreateProductInput } from "./product.interface";
import { Request as ExpressRequest } from "express";
import {
  productSearchableFields,
  productSortableFields,
} from "./product.constant";
import ApiError from "../../errors/ApiError";
import { StatusCodes } from "http-status-codes";

import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { generateUniqueSlug } from "../../../app/utils/generateSlug";
import { optimizeAndSaveImage, ensureDir } from "../../../app/utils/imageOptimizer";
import { IOptions, paginationHelper } from "../../../app/helpers/paginationHelper";
import { openai } from "../../../app/helpers/open-router";
import { AIResponse } from "../../../app/types/ai";


const createProduct = async (
  req: ExpressRequest & { files?: Express.Multer.File[] },
) => {
  const data = req.body as CreateProductInput;

  //============= Access files from request ===================//
  const files = (req as any).galleryFiles;
  const thumbnailFile = (req as any).thumbnailImage;
  const sizeGuidFile = (req as any).sizeGuidImage;

  const imageCount = (thumbnailFile ? 1 : 0) + (sizeGuidFile ? 1 : 0) + (files?.length || 0);

  // ============= Run slug + images in parallel ================//
  const slugPromise = generateUniqueSlug(data.name);

  const slug = await slugPromise;
  const productFolder = `products/${slug}`;

  // Pre-create the upload directory once
  if (imageCount > 0) {
    const uploadDir = path.join(process.cwd(), "uploads", productFolder);
    await ensureDir(uploadDir);
  }

  // ========== Parallel image optimization ==========
  const imagePromises: Promise<string>[] = [];

  if (thumbnailFile)
    imagePromises.push(optimizeAndSaveImage(thumbnailFile, productFolder));
  if (sizeGuidFile)
    imagePromises.push(optimizeAndSaveImage(sizeGuidFile, productFolder));
  if (files?.length)
    files.forEach((file: any) =>
      imagePromises.push(optimizeAndSaveImage(file, productFolder)),
    );
  const filenames = await Promise.all(imagePromises);

  let idx = 0;
  //=================== Process images =======================//
  const thumbnailUrl = thumbnailFile
    ? `/uploads/${productFolder}/${filenames[idx++]}`
    : null;
  const sizeGuidUrl = sizeGuidFile
    ? `/uploads/${productFolder}/${filenames[idx++]}`
    : null;
  const imageUrls = files?.length
    ? filenames.slice(idx).map((f) => `/uploads/${productFolder}/${f}`)
    : [];

  // ===== Process discounts =====

  return prisma.product.create({
    data: {
      name: data.name,
      slug,
      sku: data.sku,
      regularPrice: data.regularPrice,
      salePrice: data.salePrice,
      stockQuantity: data.stockQuantity || 0,
      stockStatus: data.stockStatus || "IN_STOCK",
      shortDescription: data.shortDescription,
      fullDescription: data.fullDescription,

      thumbnailImage: thumbnailUrl,
      sizeGuidImage: sizeGuidUrl,
      // ====== Images ======
      images: {
        create: imageUrls.map((url) => ({ url })),
      },

      // ===== Categories =====
      categories: data.categories
        ? {
            create: data.categories.map((category) => ({
              category: {
                connectOrCreate: {
                  where: { id: category },
                  create: { id: category, name: category },
                },
              },
            })),
          }
        : undefined,

      // ===== SubCategories =====
      subCategories: data.subCategories
        ? {
            create: data.subCategories.map((subCategory: any) => {
              if (typeof subCategory === "string") {
                return {
                  subCategory: {
                    connectOrCreate: {
                      where: { id: subCategory },
                      create: { id: subCategory, name: subCategory },
                    },
                  },
                };
              } else {
                // it's an object with id, name, parentId
                return {
                  subCategory: {
                    connectOrCreate: {
                      where: { id: subCategory.id },
                      create: {
                        id: subCategory.id,
                        name: subCategory.name,
                        parentId: subCategory.parentId || null,
                      },
                    },
                  },
                };
              }
            }),
          }
        : undefined,

      // ===== Variants =====
      variants: data.variants
        ? {
            create: data.variants.map((variant) => ({
              color: variant.color,
              size: variant.size,
              quantity: variant.quantity ?? 0,
              sku: variant.sku ?? null,
            })),
          }
        : undefined,

      // ===== Tags =====
      tags: data.tags
        ? {
            connectOrCreate: data.tags.map((tagName) => ({
              where: { name: tagName },
              create: { name: tagName },
            })),
          }
        : undefined,

      // ===== Additional Info =====
      additionalInformation: data.additionalInformation
        ? {
            create: data.additionalInformation.map((info) => ({
              label: info.label,
              value: info.value,
            })),
          }
        : undefined,
    },
    include: {
      categories: true,
      subCategories: true,
      variants: true,
      images: true,
      additionalInformation: true,
      tags: true,
      discount: true,
    },
  });
};
const getProducts = async (params: any, options: IOptions) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelper.calculatePagination(options);

  const {
    searchTerm,
    category,
    subCategory,
    priceRange,
    color,
    sale,
    ...filterData
  } = params;

  const andConditions: Prisma.ProductWhereInput[] = [];
  if (searchTerm) {
    andConditions.push({
      OR: productSearchableFields.map((field) => ({
        [field]: {
          contains: searchTerm,
          mode: "insensitive",
        },
      })),
    });
  }
  if (category) {
    andConditions.push({
      categories: {
        some: {
          categoryId: category,
        },
      },
    });
  }
  if (subCategory) {
    andConditions.push({
      subCategories: {
        some: {
          subCategoryId: subCategory,
        },
      },
    });
  }
  if (priceRange) {
    const [min, max] = (priceRange as string).split("-").map(Number);

    andConditions.push({
      OR: [
        {
          salePrice: {
            gte: min,
            lte: max,
          },
        },
        {
          regularPrice: {
            gte: min,
            lte: max,
          },
        },
      ],
    });
  }
  if (color) {
    andConditions.push({
      variants: {
        some: {
          color: {
            equals: color,
            mode: "insensitive",
          },
        },
      },
    });
  }
  if (sale) {
    andConditions.push({
      salePrice: {
        not: null,
        lt: prisma.product.fields.regularPrice,
      },
    });
  }
  if (Object.keys(filterData).length > 0) {
    andConditions.push({
      AND: Object.keys(filterData).map((key) => ({
        [key]: {
          equals: (filterData as any)[key],
        },
      })),
    });
  }

  const whereCondition: Prisma.ProductWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const safeSortBy = productSortableFields.includes(sortBy)
    ? sortBy
    : "createdAt";
  const safeSortOrder: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";

  const orderBy:
    | Prisma.ProductOrderByWithRelationInput
    | Prisma.ProductOrderByWithRelationInput[] =
    safeSortBy === "salePrice"
      ? [
          { salePrice: { sort: safeSortOrder, nulls: "last" } },
          { regularPrice: safeSortOrder },
        ]
      : { [safeSortBy]: safeSortOrder };

  const result = await prisma.product.findMany({
    skip,
    take: limit,
    orderBy,
    where: whereCondition,
    include: {
      categories: {
        include: {
          category: true,
        },
      },
      subCategories: {
        include: {
          subCategory: true,
        },
      },
      variants: true,
      images: true,
      additionalInformation: true,
      tags: true,
    },
  });
  const total = await prisma.product.count({ where: whereCondition });
  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  };
};

const getProductBySlug = async (slug: string) => {
  const product = await prisma.product.findUnique({
    where: {
      slug,
    },
    include: {
      categories: true,
      subCategories: true,
      variants: true,
      images: true,
      tags: true,
      additionalInformation: true,
    },
  });

  if (!product) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");
  }

  return product;
};

const deleteProduct = async (productId: string) => {
  //================ 1. Check if product exists ==============//
  const existingProduct = await prisma.product.findUnique({
    where: {
      id: productId,
    },
  });

  if (!existingProduct) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");
  }

  //================== 2. Delete product ====================//
  const deletedProduct = await prisma.product.delete({
    where: {
      id: productId,
    },
  });

  return deletedProduct;
};

const updateProduct = async (
  slug: string,
  req: ExpressRequest & { files?: Express.Multer.File[] },
) => {
  const data = req.body as Partial<CreateProductInput> & {
    existingGalleryImages?: string[];
    existingThumbnail?: string;
    existingSizeGuide?: string;
    removeThumbnail?: boolean;
    removeSizeGuide?: boolean;
  };

  // 1. Find existing product with images
  const existingProduct = await prisma.product.findUnique({
    where: { slug },
    include: { images: true },
  });

  if (!existingProduct) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");
  }

  const productFolder = `products/${slug}`;

  // 2. Files from request (multer attaches these via route middleware)
  const files = (req as any).galleryFiles;
  const thumbnailFile = (req as any).thumbnailImage;
  const sizeGuidFile = (req as any).sizeGuidImage;

  // 3. Ensure upload directory exists, then process new files
  const imageCount = (thumbnailFile ? 1 : 0) + (sizeGuidFile ? 1 : 0) + (files?.length || 0);
  if (imageCount > 0) {
    const uploadDir = path.join(process.cwd(), "uploads", productFolder);
    await ensureDir(uploadDir);
  }

  const imagePromises: Promise<string>[] = [];

  if (thumbnailFile) {
    imagePromises.push(optimizeAndSaveImage(thumbnailFile, productFolder));
  }
  if (sizeGuidFile) {
    imagePromises.push(optimizeAndSaveImage(sizeGuidFile, productFolder));
  }
  if (files?.length) {
    files.forEach((file: any) => {
      imagePromises.push(optimizeAndSaveImage(file, productFolder));
    });
  }

  const filenames = await Promise.all(imagePromises);
  let idx = 0;

  // 4. Thumbnail — replace old file on disk when new one uploaded,
  //    or delete it entirely when the client explicitly removed it
  let thumbnailUrl = existingProduct.thumbnailImage;
  if (thumbnailFile) {
    thumbnailUrl = `/uploads/${productFolder}/${filenames[idx++]}`;
    if (existingProduct.thumbnailImage) {
      const oldPath = path.join(process.cwd(), existingProduct.thumbnailImage);
      await fs.unlink(oldPath).catch(() => {});
    }
  } else if (data.removeThumbnail && existingProduct.thumbnailImage) {
    const oldPath = path.join(process.cwd(), existingProduct.thumbnailImage);
    await fs.unlink(oldPath).catch(() => {});
    thumbnailUrl = null;
  }

  // 5. Size Guide — replace old file on disk when new one uploaded,
  //    or delete it entirely when the client explicitly removed it
  let sizeGuidUrl = existingProduct.sizeGuidImage;
  if (sizeGuidFile) {
    sizeGuidUrl = `/uploads/${productFolder}/${filenames[idx++]}`;
    if (existingProduct.sizeGuidImage) {
      const oldPath = path.join(process.cwd(), existingProduct.sizeGuidImage);
      await fs.unlink(oldPath).catch(() => {});
    }
  } else if (data.removeSizeGuide && existingProduct.sizeGuidImage) {
    const oldPath = path.join(process.cwd(), existingProduct.sizeGuidImage);
    await fs.unlink(oldPath).catch(() => {});
    sizeGuidUrl = null;
  }

  // 6. Gallery images logic
  const newGalleryUrls = files?.length
    ? filenames.slice(idx).map((f) => `/uploads/${productFolder}/${f}`)
    : [];

  // The keep-list ALWAYS comes from the client (images the user kept in the
  // UI). Newly uploaded files are ADDED on top of it — uploading a new image
  // must NOT wipe the existing gallery.
  const keepGalleryUrls =
    data.existingGalleryImages ??
    existingProduct.images.map((img) => img.url);

  // Find old gallery records to delete (exist in DB but not in keep list)
  const deleteGalleryRecords = existingProduct.images.filter(
    (img) => !keepGalleryUrls.includes(img.url),
  );

  // Delete old gallery files from disk (silently ignore if file missing)
  await Promise.all(
    deleteGalleryRecords.map((img) => {
      const filePath = path.join(process.cwd(), img.url);
      return fs.unlink(filePath).catch(() => {});
    }),
  );

  // Delete old gallery records from database
  if (deleteGalleryRecords.length > 0) {
    await prisma.productImage.deleteMany({
      where: {
        id: { in: deleteGalleryRecords.map((img) => img.id) },
      },
    });
  }

  // 7. DELETE ONLY RELATIONS (not the product itself)
  await Promise.all([
    prisma.productCategory.deleteMany({
      where: { productId: existingProduct.id },
    }),
    prisma.productSubCategory.deleteMany({
      where: { productId: existingProduct.id },
    }),
    prisma.variant.deleteMany({
      where: { productId: existingProduct.id },
    }),
    prisma.additionalInfo.deleteMany({
      where: { productId: existingProduct.id },
    }),
  ]);

  // 8. UPDATE PRODUCT
  const updatedProduct = await prisma.product.update({
    where: { slug },

    data: {
      name: data.name ?? existingProduct.name,
      sku: data.sku ?? existingProduct.sku,
      regularPrice: data.regularPrice ?? existingProduct.regularPrice,
      salePrice: data.salePrice ?? existingProduct.salePrice,
      stockQuantity: data.stockQuantity ?? existingProduct.stockQuantity,
      stockStatus: data.stockStatus ?? existingProduct.stockStatus,
      shortDescription:
        data.shortDescription ?? existingProduct.shortDescription,
      fullDescription: data.fullDescription ?? existingProduct.fullDescription,

      thumbnailImage: thumbnailUrl,
      sizeGuidImage: sizeGuidUrl,

      // Create only NEW gallery records (old ones already deleted above)
      images: newGalleryUrls.length
        ? {
            create: newGalleryUrls.map((url) => ({ url })),
          }
        : undefined,

      // Categories
      categories: data.categories
        ? {
            create: data.categories.map((category) => ({
              category: {
                connectOrCreate: {
                  where: { id: category },
                  create: {
                    id: category,
                    name: category,
                  },
                },
              },
            })),
          }
        : undefined,

      // SubCategories
      subCategories: data.subCategories
        ? {
            create: data.subCategories.map((subCategory) => {
              if (typeof subCategory === "string") {
                return {
                  subCategory: {
                    connectOrCreate: {
                      where: {
                        id: subCategory,
                      },
                      create: {
                        id: subCategory,
                        name: subCategory,
                      },
                    },
                  },
                };
              }

              return {
                subCategory: {
                  connectOrCreate: {
                    where: {
                      id: subCategory.id,
                    },
                    create: {
                      id: subCategory.id,
                      name: subCategory.name,
                      parentId: subCategory.parentId || null,
                    },
                  },
                },
              };
            }),
          }
        : undefined,

      // Variants
      variants: data.variants
        ? {
            create: data.variants.map((variant) => ({
              color: variant.color,
              size: variant.size,
              quantity: variant.quantity ?? 0,
              sku: variant.sku ?? null,
            })),
          }
        : undefined,

      // Tags
      tags: data.tags
        ? {
            set: [],
            connectOrCreate: data.tags.map((tagName) => ({
              where: { name: tagName },
              create: { name: tagName },
            })),
          }
        : undefined,

      // Additional Info
      additionalInformation: data.additionalInformation
        ? {
            create: data.additionalInformation.map((info) => ({
              label: info.label,
              value: info.value,
            })),
          }
        : undefined,
    },

    include: {
      categories: true,
      subCategories: true,
      variants: true,
      images: true,
      additionalInformation: true,
      tags: true,
    },
  });

  return updatedProduct;
};

// const getBestSellingProducts = async () => {
//   // ===== GET TOP SELLING PRODUCTS =====
//   const bestSelling = await prisma.orderItem.groupBy({
//     by: ["productId"],
//     _sum: {
//       quantity: true,
//     },
//     orderBy: {
//       _sum: {
//         quantity: "desc",
//       },
//     },
//     take: 5,
//   });

//   const productIds = bestSelling.map((item) => item.productId);

//   // ===== FETCH PRODUCT DETAILS =====
//   const products = await prisma.product.findMany({
//     where: {
//       id: {
//         in: productIds,
//       },
//     },
//     include: {
//       categories: true,
//       subCategories: true,
//       variants: true,
//       images: true,
//       additionalInformation: true,
//       tags: true,
//     },
//   });

//   // ===== ATTACH SOLD QUANTITY & MAINTAIN ORDER =====
//   const sortedProducts = bestSelling.map((item) => {
//     const product = products.find((product) => product.id === item.productId);

//     return {
//       ...product,
//       soldQuantity: item._sum.quantity || 0,
//     };
//   });

//   return sortedProducts;
// };

const getNewArrivalProducts = async () => {
  const products = await prisma.product.findMany({
    orderBy: {
      createdAt: "desc",
    },
    take: 5,

    include: {
      categories: true,
      subCategories: true,
      variants: true,
      images: true,
      additionalInformation: true,
      tags: true,
    },
  });

  return products;
};

/**
 * Products to show under "You might also like".
 *
 * Relevance runs outward in rings, most specific first, and each ring only
 * runs if the previous one has not already filled the row:
 *
 *   1. the same sub-category — men/pant beside men/pant is the closest thing
 *      the catalogue can say without a recommendation engine
 *   2. the same category — still men, when the sub-category is thin
 *   3. the newest arrivals — so a small or freshly seeded catalogue shows a
 *      useful row rather than an empty one
 *
 * Every ring excludes what earlier rings already took, so a product can never
 * appear twice.
 */
const RELATED_LIMIT_DEFAULT = 8;
const RELATED_LIMIT_MAX = 24;

const relatedProductInclude = {
  // Names, not just join rows: the storefront builds a product URL as
  // /{category}/{subCategory}/{slug}, so a payload carrying only ids cannot be
  // linked anywhere.
  categories: { include: { category: { select: { id: true, name: true } } } },
  subCategories: { include: { subCategory: { select: { id: true, name: true } } } },
  variants: true,
  images: true,
  tags: true,
  additionalInformation: true,
} satisfies Prisma.ProductInclude;

const getRelatedProducts = async (productId: string, limit?: number) => {
  const take = Math.min(
    Math.max(1, limit ?? RELATED_LIMIT_DEFAULT),
    RELATED_LIMIT_MAX,
  );

  const currentProduct = await prisma.product.findUnique({
    where: { id: productId },
    include: { categories: true, subCategories: true },
  });

  if (!currentProduct) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Product not found");
  }

  const categoryIds = currentProduct.categories.map((c) => c.categoryId);
  const subCategoryIds = currentProduct.subCategories.map((s) => s.subCategoryId);

  // A storefront endpoint must never surface something the shop has hidden or
  // deleted — the previous version returned both.
  const visible = { isDeleted: false, isActive: true };

  type RelatedProduct = Prisma.ProductGetPayload<{
    include: typeof relatedProductInclude;
  }>;

  const collected: RelatedProduct[] = [];
  const excluded = new Set<string>([productId]);

  const fill = async (where: Prisma.ProductWhereInput) => {
    const remaining = take - collected.length;
    if (remaining <= 0) return;

    const rows = await prisma.product.findMany({
      where: { ...visible, ...where, id: { notIn: Array.from(excluded) } },
      include: relatedProductInclude,
      orderBy: { createdAt: "desc" },
      take: remaining,
    });

    for (const row of rows) {
      collected.push(row);
      excluded.add(row.id);
    }
  };

  if (subCategoryIds.length) {
    await fill({ subCategories: { some: { subCategoryId: { in: subCategoryIds } } } });
  }

  if (categoryIds.length) {
    await fill({ categories: { some: { categoryId: { in: categoryIds } } } });
  }

  await fill({});

  return collected;
};


//============ Storefront search =============//

/**
 * Search is public, so it only ever sees products a shopper could actually
 * buy. `getProducts` above does not apply this — it backs the admin listing
 * too — which is why search does not go through it.
 */
const publicOnly = { isDeleted: false, isActive: true } satisfies Prisma.ProductWhereInput;

/**
 * Every word has to match something, so "baggy denim" narrows the result set
 * instead of widening it the way a plain OR would. Each word may match the
 * name, the SKU, or a tag/category the product is filed under, so word order
 * doesn't matter and "denim baggy" finds the same things.
 */
const buildSearchWhere = (query: string): Prisma.ProductWhereInput => {
  const tokens = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (tokens.length === 0) return publicOnly;

  return {
    ...publicOnly,
    AND: tokens.map((token) => ({
      OR: [
        { name: { contains: token, mode: "insensitive" } },
        { sku: { contains: token, mode: "insensitive" } },
        { tags: { some: { name: { contains: token, mode: "insensitive" } } } },
        {
          categories: {
            some: { category: { name: { contains: token, mode: "insensitive" } } },
          },
        },
        {
          subCategories: {
            some: { subCategory: { name: { contains: token, mode: "insensitive" } } },
          },
        },
      ],
    })),
  };
};

/** The full result set behind /search, shaped like the category listings. */
const searchProducts = async (
  query: string,
  options: IOptions,
  filters: { sale?: string } = {},
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelper.calculatePagination(options);

  if (!query.trim()) {
    return { meta: { page, limit, total: 0 }, data: [] };
  }

  const where = buildSearchWhere(query);

  // "Sale" is an option in the same dropdown as the sorts, so search has to
  // honour it or picking it would silently do nothing.
  if (filters.sale === "true") {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { salePrice: { not: null, lt: prisma.product.fields.regularPrice } },
    ];
  }

  const safeSortBy = productSortableFields.includes(sortBy) ? sortBy : "createdAt";
  const safeSortOrder: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";
  const orderBy:
    | Prisma.ProductOrderByWithRelationInput
    | Prisma.ProductOrderByWithRelationInput[] =
    safeSortBy === "salePrice"
      ? [
          { salePrice: { sort: safeSortOrder, nulls: "last" } },
          { regularPrice: safeSortOrder },
        ]
      : { [safeSortBy]: safeSortOrder };

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        categories: { include: { category: true } },
        subCategories: { include: { subCategory: true } },
        variants: true,
        images: true,
        tags: true,
      },
    }),
    prisma.product.count({ where }),
  ]);

  return { meta: { page, limit, total }, data };
};

/**
 * Typeahead. Fires on every pause in typing, so it returns only what the
 * suggestion row draws — a thumbnail, a name, a price and the two segments
 * its link needs — rather than the whole product graph.
 */
const suggestProducts = async (query: string, limit = 6) => {
  if (!query.trim()) return { total: 0, data: [] };

  const where = buildSearchWhere(query);
  const take = Math.min(10, Math.max(1, limit));

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        name: true,
        slug: true,
        thumbnailImage: true,
        regularPrice: true,
        salePrice: true,
        images: { take: 1, select: { url: true } },
        categories: { take: 1, select: { category: { select: { name: true } } } },
        subCategories: {
          take: 1,
          select: { subCategory: { select: { name: true } } },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    total,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      image: row.thumbnailImage ?? row.images[0]?.url ?? null,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      category: row.categories[0]?.category?.name ?? null,
      subCategory: row.subCategories[0]?.subCategory?.name ?? null,
    })),
  };
};

const getAISuggestion = async (
    searchIntent: string,
    history: { type: "user" | "ai"; text: string }[] = []
) => {
    try {
        // 1️ Fetch all products
        const products = await prisma.product.findMany({
            include: {
                categories: { include: { category: true } },
                subCategories: { include: { subCategory: true } },
                variants: true,
                images: true,
                tags: true,
                additionalInformation: true,
            },
        });

        if (!products.length) {
            return {
                message: "No products available right now.",
                reasoning: "",
                products: [],
            };
        }

        // 2️ Map chat history
        const chatHistory: ChatCompletionMessageParam[] = history.map((msg) => ({
            role: msg.type === "user" ? "user" : "assistant",
            content: msg.text,
        }));

        // 3️ Build AI messages
        const messages: ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: `You are an advanced AI shopping assistant.
                - Understand user intent deeply.
                - If the user is asking about products, ALWAYS suggest products.
                - Extract filters (color, category, price, keywords) if needed.
                - ALWAYS return JSON FORMAT:
                {
                "showProducts": true/false,
                "message": "friendly response",
                "reasoning": "why these products match",
                "filters": {
                    "color": "",
                    "category": "",
                    "minPrice": 0,
                    "maxPrice": 0,
                    "keywords": ""
                }
                }`,
            },
            ...chatHistory,
            { role: "user", content: searchIntent },
        ];

        // 4️ Call OpenAI
        const aiResponse = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages,
        });

        const aiText = aiResponse.choices[0]?.message?.content || "{}";

        let aiData: AIResponse & { showProducts?: boolean };
        try {
            aiData = JSON.parse(aiText);
        } catch {
            aiData = { showProducts: false, message: "", reasoning: "", filters: {} };
        }

        // 5️ **Force showProducts = true if query looks like shopping intent**
        const shoppingKeywords = ["buy", "shop", "product", "t-shirt", "shirt", "panjabi", "jeans"];
        const userWantsProducts =
            aiData.showProducts || shoppingKeywords.some((kw) =>
                searchIntent.toLowerCase().includes(kw.toLowerCase())
            );

        const { filters = {}, message, reasoning } = aiData;

        // 6️ Filter products
        let filteredProducts: typeof products = [];

        if (userWantsProducts) {
            filteredProducts = products
                .map((p) => {
                    const price = p.salePrice ?? p.regularPrice ?? 0;
                    let score = 0;

                    const matchesColor = filters.color
                        ? p.variants?.some((v) =>
                            v.color?.toLowerCase().includes(filters.color!.toLowerCase())
                        )
                        : true;
                    const matchesCategory = filters.category
                        ? p.categories?.some((c) =>
                            c.category.name.toLowerCase().includes(filters.category!.toLowerCase())
                        )
                        : true;
                    const matchesKeyword = filters.keywords
                        ? p.name.toLowerCase().includes(filters.keywords.toLowerCase())
                        : true;
                    const matchesPrice =
                        (!filters.minPrice || price >= filters.minPrice) &&
                        (!filters.maxPrice || price <= filters.maxPrice);

                    // Score calculation (optional)
                    if (matchesColor && filters.color) score += 3;
                    if (matchesCategory && filters.category) score += 3;
                    if (matchesKeyword && filters.keywords) score += 2;
                    if (filters.maxPrice) score += 1;

                    return { ...p, matchesColor, matchesCategory, matchesKeyword, matchesPrice, score };
                })
                // Include products that **match at least one filter** OR **if all filters empty**
                .filter((p) =>
                    (filters.color || filters.category || filters.keywords || filters.minPrice || filters.maxPrice)
                        ? p.matchesColor || p.matchesCategory || p.matchesKeyword || p.matchesPrice
                        : true
                )
                .sort((a, b) => b.score - a.score)
                .slice(0, 6);

            // Fallback: if no products match, show top 6 anyway
            if (filteredProducts.length === 0) filteredProducts = products.slice(0, 6);
        }

        return {
            message: message || "Here are some products for you ",
            reasoning: reasoning || "These products best match your request.",
            products: filteredProducts,
        };
    } catch (error: any) {
        console.error("AI Suggestion Error:", error);
        throw new Error("Failed to fetch AI suggestions");
    }
};


export const ProductService = {
  createProduct,
  getProducts,
  getProductBySlug,
  deleteProduct,
  updateProduct,
  getNewArrivalProducts,
  getRelatedProducts,
  searchProducts,
  suggestProducts,
  getAISuggestion
};