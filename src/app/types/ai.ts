export type AIResponse = {
  message?: string;
  reasoning?: string;
  filters?: {
    color?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    keywords?: string;
    occasion?: string;
    style?: string;
  };
};