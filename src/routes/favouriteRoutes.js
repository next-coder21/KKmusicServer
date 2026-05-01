const express = require("express");
const router = express.Router();
const favouritesController = require("../controllers/favouriteController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.post("/favourites/add",    authMiddleware, favouritesController.addFavourites);
router.get("/favourites",         authMiddleware, favouritesController.getFavourites);
router.post("/favourites/remove", authMiddleware, favouritesController.removeFavourites);

module.exports = router;
