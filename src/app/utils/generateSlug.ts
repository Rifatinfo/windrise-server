import { prisma } from "@/shared";
import slugify from "slugify";

export const generateUniqueSlug = async (
  name: string
): Promise<string> => {
  const baseSlug = slugify(name, {
    lower: true,
    strict: true,
    trim: true,
  });

  const count = await prisma.product.count({
    where: {
      slug: {
        startsWith: baseSlug,
      },
    },
  });

  if (count === 0) return baseSlug;

  // Find the actual max suffix to avoid collisions
  const latest = await prisma.product.findFirst({
    where: {
      slug: {
        startsWith: `${baseSlug}-`,
      },
    },
    orderBy: { createdAt: "desc" },
    select: { slug: true },
  });

  if (!latest) return `${baseSlug}-1`;

  const match = latest.slug.match(new RegExp(`^${baseSlug}-(\\d+)$`));
  const nextNumber = match ? Number(match[1]) + 1 : count + 1;
  return `${baseSlug}-${nextNumber}`;
};
