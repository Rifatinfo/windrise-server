import { DeliveryType } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import ApiError from "../errors/ApiError";


export const parseDeliveryType = (type: string): DeliveryType => {
  switch (type) {
   
    case "DHAKA_CITY":
      return DeliveryType.DHAKA_CITY;
    case "OUTSIDE_DHAKA":
      return DeliveryType.OUTSIDE_DHAKA;
    case "DHAKA_SUBURB":
      return DeliveryType.DHAKA_SUBURB;
      
    default:
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid delivery type");
  }
};