const express = require("express");
const router = express.Router();
const favouritesController = require("../controllers/favouriteController");

router.post("/favourites/add", favouritesController.addFavourites);
router.get("/favourites/:email", favouritesController.getFavourites);
router.post("/favourites/remove", favouritesController.removeFavourites);

module.exports = router;
