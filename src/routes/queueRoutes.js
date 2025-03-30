const express = require("express");
const router = express.Router();
const queueController = require("../controllers/queueController");

router.post("/add", queueController.addToQueue);
router.get("/:email", queueController.getQueue);
router.post("/remove", queueController.removeFromQueue);
router.delete("/clear/:email", queueController.clearQueue);

module.exports = router;
