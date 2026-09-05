import { StockStatus } from "@prisma/client";

export interface CreateProductInput {
    name: string;
    slug?: string;
    sku: string;
    regularPrice: number;
    salePrice?: number;
    stockQuantity?: number;
    stockStatus: StockStatus;
    shortDescription?: string;
    fullDescription?: string;
    categories?: string[];
    subCategories?: (string | { id: string; name: string; parentId?: string })[];
    variants?: Array<{ color?: string; size?: string; quantity?: number; sku?: string }>;
    sizeGuidImage?: string;
    thumbnailImage?: string;
    images?: string[];
    tags?: string[];
    additionalInformation?: Array<{ label: string; value: string }>;

    
};