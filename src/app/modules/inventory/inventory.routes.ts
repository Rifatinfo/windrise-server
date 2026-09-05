import { Router } from "express";

import { InventoryController } from "./inventory.controller";

const router = Router();

router.get("/overview", InventoryController.getInventoryOverview);
router.patch("/product/:productId/stock", InventoryController.adjustProductStock);

export const InventoryRoutes = router;
