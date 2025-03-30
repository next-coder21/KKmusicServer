const express = require("express");
const multer = require("multer");
const authController = require("../controllers/authController");
const { authMiddleware } = require("../middleware/authMiddleware"); // ✅ Protect routes

const router = express.Router();

// ✅ Configure Multer for Image Uploads (Store Base64 in DB)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ✅ Define Routes
router.post("/register", authController.register);
router.post("/verify", authController.verifyEmail);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);

// ✅ PROTECT update-account with authMiddleware
router.post("/update-account", authMiddleware, upload.single("image"), authController.updateAccount);

router.post("/reset-password", authController.resetPassword);
router.get("/check-auth", authMiddleware, authController.checkAuth);
router.post("/logout", authController.logout);

module.exports = router;
