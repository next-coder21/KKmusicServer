const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.post("/add",    authMiddleware, queueController.addToQueue);
router.get("/",        authMiddleware, queueController.getQueue);
router.post("/remove", authMiddleware, queueController.removeFromQueue);
router.delete("/clear",authMiddleware, queueController.clearQueue);

module.exports = router;
