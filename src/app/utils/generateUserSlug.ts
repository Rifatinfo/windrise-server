import crypto from "crypto";
import slugify from "slugify";



export const generateUserSlug = (name?: string): string => {
    const baseSlug = name
        ? slugify(name, { lower: true, strict: true, trim: true })
        : "user";

    // add a short random hex to ensure uniqueness
    const randomSuffix = crypto.randomBytes(3).toString("hex");

    return `${baseSlug}-${randomSuffix}`;
};