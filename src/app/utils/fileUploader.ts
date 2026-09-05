
import multer from "multer";


//  Use memory storage (you can switch to diskStorage if needed)
const storage = multer.memoryStorage();

// Common multer configuration
export const multerConfig = {
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 5MB
    files: 16, 
  },
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
};

/**
 * Post content accepts more than images — video, audio and document
 * attachments all get inserted straight from the editor. Kept as an
 * allowlist so an upload endpoint never becomes a way to host arbitrary
 * executable content.
 */
const MEDIA_MIME_PREFIXES = ["image/", "video/", "audio/"];

const MEDIA_MIME_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const isAllowedMediaMime = (mimetype: string) =>
  MEDIA_MIME_PREFIXES.some((prefix) => mimetype.startsWith(prefix)) ||
  MEDIA_MIME_EXACT.has(mimetype);

/** Same storage as `multerConfig`, but for post media rather than images. */
export const mediaMulterConfig = {
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 16,
  },
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (!isAllowedMediaMime(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
};

//  Single file upload
const singleUpload = (fieldName: string) => multer(multerConfig).single(fieldName);

//  Multiple files upload
const multipleUpload = (fieldName: string, maxCount = 16) => multer(multerConfig).array(fieldName, maxCount);

// Export both
export const fileUploader = {
  singleUpload,
  multipleUpload,
};