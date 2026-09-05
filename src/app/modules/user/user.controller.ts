import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import pick from "../../../shared/pick";
import { userFilterableFields } from "./user.constant";
import { UserService, type StaffRole } from "./user.service";
import { UserRole } from "@prisma/client";

const createCustomer = catchAsync(
  async (req: Request & { file?: Express.Multer.File }, res: Response) => {
 
    const result = await UserService.createCustomer(req);
    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: "Customer Created Successfully",
      data: result,
    });
  }
);

const getAllFromDB = catchAsync(async (req: Request, res: Response) => {
    const filters = pick(req.query, userFilterableFields) // searching , filtering
    const options = pick(req.query, ["page", "limit", "sortBy", "sortOrder"]) // pagination and sorting

    const result = await UserService.getAllFromDB(filters, options);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: "User retrieved successfully!",
        meta: result.meta,
        data: result.data
    })
});

const createAdmin = catchAsync(async (req: Request & { file?: Express.Multer.File }, res: Response) => {

    const result = await UserService.createAdmin(req);
    sendResponse(res, {
        statusCode : 201,
        success : true,
        message : "Admin Created Successfully",
        data : result
    });
});

/** One handler factory for every "Add <role>" page. */
const createStaffHandler = (role: StaffRole, label: string) =>
    catchAsync(async (req: Request & { file?: Express.Multer.File }, res: Response) => {
        const result = await UserService.createStaff(role, req);
        sendResponse(res, {
            statusCode: 201,
            success: true,
            message: `${label} Created Successfully`,
            data: result,
        });
    });

const createShopManager = createStaffHandler(UserRole.SHOP_MANAGER, "Shop Manager");
const createMediaManager = createStaffHandler(UserRole.MEDIA_MANAGER, "Media Manager");
const createCustomerSupport = createStaffHandler(UserRole.CUSTOMER_SUPPORT, "Customer Support");

const updateAdmin = catchAsync(async (req: Request & { file?: Express.Multer.File }, res: Response) => {
    const result = await UserService.updateAdmin(req.params.id, req);
    sendResponse(res, {
        statusCode : 200,
        success : true,
        message : "Admin Updated Successfully",
        data : result
    });
});

const updateMyProfile = catchAsync(
    async (req: Request & { user?: { id?: string }; file?: Express.Multer.File }, res: Response) => {
        const result = await UserService.updateMyProfile(req.user!.id as string, req);
        sendResponse(res, {
            statusCode: 200,
            success: true,
            message: "Profile updated successfully",
            data: result,
        });
    }
);

const updateAdminStatus = catchAsync(async (req: Request, res: Response) => {
    const requesterId = (req as Request & { user?: { id?: string } }).user?.id;
    const result = await UserService.updateAdminStatus(req.params.id, req.body.status, requesterId);
    sendResponse(res, {
        statusCode : 200,
        success : true,
        message : "Admin Status Updated Successfully",
        data : result
    });
});

const deleteAdmin = catchAsync(async (req: Request, res: Response) => {
    const requesterId = (req as Request & { user?: { id?: string } }).user?.id;
    const result = await UserService.deleteAdmin(req.params.id, requesterId);
    sendResponse(res, {
        statusCode : 200,
        success : true,
        message : "Admin Deleted Successfully",
        data : result
    });
});

export const UserController = {
    createCustomer,
    getAllFromDB,
    createAdmin,
    createShopManager,
    createMediaManager,
    createCustomerSupport,
    updateAdmin,
    updateMyProfile,
    updateAdminStatus,
    deleteAdmin,
};