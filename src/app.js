const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser"); // ✅ Import cookie-parser
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const musicRoutes = require("./routes/musicRoutes");
const queueRoutes = require("./routes/queueRoutes")
const favouriteRoute = require("./routes/favouriteRoutes")

const app = express();
app.set("trust proxy", 1); // ✅ Trust Render proxy for cookies

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://192.168.43.254:5173",
  "https://k-kmusic.vercel.app",
  "https://muves-website.vercel.app"
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow local development and specific Vercel domains
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // ✅ Use cookie-parser

app.use("/auth", authRoutes);
app.use("/auth/music", musicRoutes);
app.use("/auth/queue",queueRoutes)
app.use("/auth",favouriteRoute)

// ✅ Admin Panel Routes
const adminRoutes = require("./routes/adminRoutes");
app.use("/admin", adminRoutes);

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("[Global Error]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

module.exports = app;
