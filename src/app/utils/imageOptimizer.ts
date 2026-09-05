import sharp from "sharp";
import path from "path";
import fs from "fs/promises";

sharp.concurrency(4);

export const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

export const optimizeAndSaveImage = async (
  file: Express.Multer.File,
  folder: string
): Promise<string> => {
  const uploadDir = path.join(process.cwd(), "uploads", folder);

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
  const filepath = path.join(uploadDir, filename);

  await ensureDir(uploadDir);

  await sharp(file.buffer)
    .resize(1200, 1200, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toFile(filepath);

  return filename;
};

/** Strip anything that could escape the upload folder or fake an extension. */
const safeExtension = (originalname: string) => {
  const match = /\.([a-z0-9]{1,8})$/i.exec(originalname ?? "");
  return match ? `.${match[1].toLowerCase()}` : "";
};

/**
 * Stores a file byte-for-byte. Used for video, audio and document
 * attachments, which must not go through sharp.
 */

export const saveRawFile = async (
  file: Express.Multer.File,
  folder: string
): Promise<string> => {
  const uploadDir = path.join(process.cwd(), "uploads", folder);
  await ensureDir(uploadDir);

  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExtension(
    file.originalname
  )}`;

  await fs.writeFile(path.join(uploadDir, filename), file.buffer);
  return filename;
};
