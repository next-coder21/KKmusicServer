const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser"); // ✅ Import cookie-parser
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const musicRoutes = require("./routes/musicRoutes");
const queueRoutes = require("./routes/queueRoutes")
const favouriteRoute = require("./routes/favouriteRoutes")

const app = express();

app.use(cors({
  origin: ["http://localhost:5173", "http://192.168.43.254:5173","https://k-kmusic.vercel.app"], 
  credentials: true, // Allow cookies
  methods: ["GET", "POST", "PUT", "DELETE"], // ✅ Explicitly allow methods
  allowedHeaders: ["Content-Type", "Authorization"], // ✅ Allow headers
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // ✅ Use cookie-parser

app.use("/auth", authRoutes);
app.use("/auth/music", musicRoutes);
app.use("/auth/queue",queueRoutes)
app.use("/auth",favouriteRoute)




module.exports = app;
