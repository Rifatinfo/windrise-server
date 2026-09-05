import {z} from "zod";

// Validation schema for creating a new user 
const createUserValidationSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters long" ).optional(),
  
  email: z
    .string()
    .email( "Invalid email address"),
  
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long" ),
  
});
const createAdminValidationSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters long" ).optional(),
  
  email: z
    .string()
    .email( "Invalid email address"),
  
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long" ),
  phone : z.string().min(11, "Phone must be at least 11 characters long" ).optional(),
  
});

const updateAdminValidationSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters long" )
    .optional(),
  email: z
    .string()
    .email("Invalid email address")
    .optional(),
});

const updateAdminStatusValidationSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "DELETED"]),
});

// Self-service profile edit. Email is deliberately excluded — it is the
// login identity, so changing it belongs to an admin/verification flow.
const updateMyProfileValidationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(80, "Name must be 80 characters or fewer")
    .optional(),
  phone: z
    .string()
    .trim()
    .max(30, "Phone must be 30 characters or fewer")
    .optional(),
  // Explicit request to clear the current photo.
  removeAvatar: z.boolean().optional(),
});

export const UserValidation = {
  createUserValidationSchema,
  createAdminValidationSchema,
  updateAdminValidationSchema,
  updateAdminStatusValidationSchema,
  updateMyProfileValidationSchema,
};

