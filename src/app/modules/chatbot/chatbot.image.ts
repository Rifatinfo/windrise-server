import path from "path";
import fs from "fs/promises";
import sharp from "sharp";

/**
 * Turns a stored chat attachment into a data URL for the model.
 *
 * The image cannot be sent as a link: the provider fetches image URLs from its
 * own servers, so a `http://localhost:5000/...` address resolves to *their*
 * machine and the request comes back as "Provider returned error". Any host
 * that is private, firewalled or not yet public fails the same way. Inlining
 * the bytes sidesteps the question entirely.
 *
 * It is also re-encoded smaller than the stored copy — the model gains nothing
 * from 1200px, and the base64 payload is a third larger than the file, so the
 * request would be needlessly slow and expensive.
 */

/** Vision models tile at 768px; past that is paid for and thrown away. */
const MAX_EDGE = 768;
const QUALITY = 70;

export async function attachmentAsDataUrl(imageUrl: string): Promise<string | null> {
  // The path is validated on the way in, but it is still only ever joined by
  // its basename so nothing can climb out of the upload folder.
  const filename = path.basename(imageUrl);
  const filepath = path.join(process.cwd(), "uploads", "chat", filename);

  try {
    const original = await fs.readFile(filepath);
    const resized = await sharp(original)
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();

    return `data:image/webp;base64,${resized.toString("base64")}`;
  } catch {
    // Missing or unreadable: the turn goes ahead without the picture rather
    // than failing the whole reply.
    return null;
  }
}
