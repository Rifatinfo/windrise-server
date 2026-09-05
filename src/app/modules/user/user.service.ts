
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Request } from "express";
import prisma from "../../../shared/prisma";


import { userSearchableFields } from "./user.constant";

import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { optimizeAndSaveImage } from "../../../app/utils/imageOptimizer";
import { generateUserSlug } from "../../../app/utils/generateUserSlug";
import { IOptions, paginationHelper } from "../../../app/helpers/paginationHelper";
import ApiError from "../../../app/errors/ApiError";
import { StatusCodes } from "http-status-codes";



const createCustomer = async (
  req: Request & { file?: Express.Multer.File }
) => {
  const { name, email, password } = req.body;

  // ===== 1. Generate slug =====
  const slug = generateUserSlug(name?.trim());

  // ===== 2. Parallel processing  =====
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

  const [hashedPassword, filename] = await Promise.all([
    bcrypt.hash(password, saltRounds),

    req.file
      ? optimizeAndSaveImage(req.file, `users/${slug}`)
      : Promise.resolve(null),
  ]);

  const avatarUrl = filename
    ? `/uploads/users/${slug}/${filename}`
    : null;

  // ===== 3. Create User =====
  const user = await prisma.user.create({
    data: {
      email,
      name,
      slug, 
      password: hashedPassword,
      avatar: avatarUrl,
      role: UserRole.CUSTOMER,
      needPasswordChange: false,   // newly added 
    },
  });

  // ===== 4. Create related data (Batch Transaction ) =====
  await prisma.$transaction([
    prisma.authProvider.create({
      data: {
        provider: "CREDENTIALS",
        password: hashedPassword,
        userId: user.id,
      },
    }),

    prisma.customer.create({
      data: {
        userId: user.id,
        name,
        email,
        avatar: avatarUrl,
        password : hashedPassword
      },
    }),
  ]);

  // ===== 5. Return clean response =====
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
  };
};

const getAllFromDB = async (params: any, options: IOptions) => {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(options)
    const { searchTerm, ...filterData } = params;

    const andConditions: Prisma.UserWhereInput[] = [];

    if (searchTerm) {
        andConditions.push({
            OR: userSearchableFields.map(field => ({
                [field]: {
                    contains: searchTerm,
                    mode: "insensitive"
                }
            }))
        })
    }

    if (Object.keys(filterData).length > 0) {
        andConditions.push({
            AND: Object.keys(filterData).map(key => ({
                [key]: {
                    equals: (filterData as any)[key]
                }
            }))
        })
    }

    const whereConditions: Prisma.UserWhereInput = andConditions.length > 0 ? {
        AND: andConditions
    } : {}

    const result = await prisma.user.findMany({
        skip,
        take: limit,
        where: whereConditions,
        orderBy: {
            [sortBy]: sortOrder
        }
    });

    const total = await prisma.user.count({
        where: whereConditions
    });
    return {
        meta: {
            page,
            limit,
            total
        },
        data: result
    };
}


/**
 * Roles that represent staff accounts created from the "Admin Role" section
 * of the dashboard. Customers are created through the storefront instead.
 */
export const STAFF_ROLES = [
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
    UserRole.MEDIA_MANAGER,
    UserRole.CUSTOMER_SUPPORT,
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

const STAFF_LABEL: Record<StaffRole, string> = {
    [UserRole.ADMIN]: "Admin",
    [UserRole.SHOP_MANAGER]: "Shop manager",
    [UserRole.MEDIA_MANAGER]: "Media manager",
    [UserRole.CUSTOMER_SUPPORT]: "Customer support",
};

const isStaffRole = (role: UserRole): role is StaffRole =>
    (STAFF_ROLES as readonly UserRole[]).includes(role);

/** Writes the role-specific profile row that mirrors the user record. */
const createStaffProfile = async (
    tx: Prisma.TransactionClient,
    role: StaffRole,
    data: {
        userId: string;
        name?: string;
        email: string;
        phone?: string;
        avatar: string | null;
        password: string;
    }
) => {
    if (role === UserRole.ADMIN) return tx.admin.create({ data });
    if (role === UserRole.SHOP_MANAGER) return tx.shopManager.create({ data });
    if (role === UserRole.MEDIA_MANAGER) return tx.mediaManager.create({ data });
    return tx.customerSupport.create({ data });
};

/**
 * Creates a staff account: the `User` login record plus its role profile.
 * Shared by every "Add <role>" page so the four flows can't drift apart.
 */
const createStaff = async (
    role: StaffRole,
    req: Request & { file?: Express.Multer.File }
) => {
    const { name, email, password, phone } = req.body;

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "That email is already registered");
    }

    const slug = name
        ? await generateUserSlug(name.trim())
        : `user-${crypto.randomBytes(6).toString("hex")}`;

    let avatarUrl: string | null = null;
    if (req.file) {
        const userFolder = `users/${slug}`;
        const filename = await optimizeAndSaveImage(req.file, userFolder);
        avatarUrl = `/uploads/${userFolder}/${filename}`;
    }

    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    return prisma.$transaction(
        async (tx) => {
            const user = await tx.user.create({
                data: { email, name, password: hashedPassword, avatar: avatarUrl, slug, role },
            });

            return createStaffProfile(tx, role, {
                userId: user.id,
                name,
                email,
                phone,
                avatar: avatarUrl,
                password: hashedPassword,
            });
        },
        { maxWait: 20000, timeout: 30000 }
    );
};

const createAdmin = (req: Request & { file?: Express.Multer.File }) =>
    createStaff(UserRole.ADMIN, req);

const updateAdmin = async (
  id: string,
  req: Request & { file?: Express.Multer.File }
) => {
  const { name, email } = req.body;

  const existing = await prisma.user.findUnique({ where: { id } });
  // Any staff role is manageable from the Admin Role pages, not just ADMIN.
  if (!existing || !isStaffRole(existing.role)) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Staff account not found");
  }
  if (existing.isDeleted || existing.status === UserStatus.DELETED) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `${STAFF_LABEL[existing.role]} has been deleted`
    );
  }

  let avatarUrl = existing.avatar;
  if (req.file) {
    const folder = `users/${existing.slug ?? generateUserSlug(existing.name ?? "user")}`;
    const filename = await optimizeAndSaveImage(req.file, folder);
    avatarUrl = `/uploads/${folder}/${filename}`;
  }

  const profileData = {
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
    ...(avatarUrl !== existing.avatar && { avatar: avatarUrl }),
  };

  // Mirror the change onto whichever profile table this staff role owns.
  const profileUpdate =
    existing.role === UserRole.ADMIN
      ? prisma.admin.update({ where: { userId: id }, data: profileData })
      : existing.role === UserRole.SHOP_MANAGER
        ? prisma.shopManager.update({ where: { userId: id }, data: profileData })
        : existing.role === UserRole.MEDIA_MANAGER
          ? prisma.mediaManager.update({ where: { userId: id }, data: profileData })
          : prisma.customerSupport.update({ where: { userId: id }, data: profileData });

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: profileData }),
    profileUpdate,
  ]);

  return prisma.user.findUnique({ where: { id } });
};

/**
 * Self-service profile update for the signed-in user.
 *
 * Unlike `updateAdmin` this works for every role, only ever touches the
 * caller's own rows, and never changes the email (the login identity).
 */
const updateMyProfile = async (
  userId: string,
  req: Request & { file?: Express.Multer.File }
) => {
  const { name, phone, removeAvatar } = req.body as {
    name?: string;
    phone?: string;
    removeAvatar?: boolean;
  };

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }
  if (existing.isDeleted || existing.status === UserStatus.DELETED) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This account has been deleted");
  }

  let avatarUrl = existing.avatar;
  if (req.file) {
    const folder = `users/${existing.slug ?? generateUserSlug(existing.name ?? "user")}`;
    const filename = await optimizeAndSaveImage(req.file, folder);
    avatarUrl = `/uploads/${folder}/${filename}`;
  } else if (removeAvatar) {
    avatarUrl = null;
  }

  const avatarChanged = avatarUrl !== existing.avatar;
  // An empty phone string means "clear it", not "set it to empty".
  const phoneValue = phone === undefined ? undefined : phone === "" ? null : phone;

  const sharedData = {
    ...(name !== undefined && { name }),
    ...(avatarChanged && { avatar: avatarUrl }),
  };

  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.user.update({ where: { id: userId }, data: sharedData }),
  ];

  // Mirror onto whichever role profile this user has. Customers have no
  // phone column, so it is only written for the roles that do.
  const profileData = { ...sharedData, ...(phoneValue !== undefined && { phone: phoneValue }) };

  if (existing.role === UserRole.ADMIN) {
    writes.push(prisma.admin.update({ where: { userId }, data: profileData }));
  } else if (existing.role === UserRole.SHOP_MANAGER) {
    writes.push(prisma.shopManager.update({ where: { userId }, data: profileData }));
  } else if (existing.role === UserRole.MEDIA_MANAGER) {
    writes.push(prisma.mediaManager.update({ where: { userId }, data: profileData }));
  } else if (existing.role === UserRole.CUSTOMER_SUPPORT) {
    writes.push(prisma.customerSupport.update({ where: { userId }, data: profileData }));
  } else if (existing.role === UserRole.CUSTOMER) {
    writes.push(prisma.customer.update({ where: { userId }, data: sharedData }));
  }

  await prisma.$transaction(writes);

  const updated = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      admin: true,
      customer: true,
      shopManager: true,
      mediaManager: true,
    },
  });

  // Never hand password hashes back to the browser.
  const strip = <T extends { password?: string | null } | null>(profile: T) =>
    profile ? { ...profile, password: undefined } : profile;

  return {
    id: updated.id,
    email: updated.email,
    name: updated.name,
    avatar: updated.avatar,
    role: updated.role,
    status: updated.status,
    needPasswordChange: updated.needPasswordChange,
    admin: strip(updated.admin),
    customer: strip(updated.customer),
    shopManager: strip(updated.shopManager),
    mediaManager: strip(updated.mediaManager),
  };
};

const updateAdminStatus = async (
  id: string,
  status: UserStatus,
  requesterId?: string
) => {
  if (id === requesterId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot deactivate your own account"
    );
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || !isStaffRole(existing.role)) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Staff account not found");
  }
  if (existing.isDeleted) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `${STAFF_LABEL[existing.role]} has been deleted`
    );
  }

  return prisma.user.update({
    where: { id },
    data: {
      status,
      isDeleted: status === UserStatus.DELETED,
    },
  });
};

const deleteAdmin = async (id: string, requesterId?: string) => {
  if (id === requesterId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot delete your own account");
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || !isStaffRole(existing.role)) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Staff account not found");
  }

  return prisma.user.update({
    where: { id },
    data: {
      isDeleted: true,
      status: UserStatus.DELETED,
    },
  });
};


export const UserService = {
    createCustomer,
    getAllFromDB,
    createAdmin,
    createStaff,
    updateAdmin,
    updateMyProfile,
    updateAdminStatus,
    deleteAdmin,
};