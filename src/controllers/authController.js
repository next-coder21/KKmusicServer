const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/User');
const { sendEmail } = require('../utils/email');
const multer = require("multer");
require('dotenv').config();

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Register with OTP
exports.register = async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000); // Generate 6-digit OTP

    await pool.query(
      'INSERT INTO users (name, email, password, otp) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, hashedPassword, otp]
    );

    await sendEmail(email, 'Verify Email', `Your OTP for verification: ${otp}`);
    res.status(201).json({ message: 'User registered! Check your email for OTP verification.' });
  } catch (error) {
    res.status(500).json({ error: 'Error registering user' });
  }
};

// Verify Email with OTP
exports.verifyEmail = async (req, res) => {
    console.log("Tpouched");
    
  const { email, otp } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'Invalid email' });

    if (user.rows[0].otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });

    await pool.query('UPDATE users SET is_verified = TRUE, otp = NULL WHERE email = $1', [email]);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Verification failed' });
  }
};

// Login (Only verified users)
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Fetch user details along with profile info
    const userQuery = `
      SELECT 
        u.id, u.name, u.email, u.is_verified, u.password,
        p.dob, p.gender, p.image
      FROM users u
      LEFT JOIN user_profiles p ON u.email = p.email
      WHERE u.email = $1
    `;
    const user = await pool.query(userQuery, [email]);

    if (user.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const userData = user.rows[0];

    // Ensure user is verified
    if (!userData.is_verified) {
      return res.status(403).json({ error: "Please verify your email first" });
    }

    // Validate password
    const validPassword = await bcrypt.compare(password, userData.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Invalid password" });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { userId: userData.id }, 
      process.env.JWT_SECRET, 
      { expiresIn: "7d" }
    );

    // ✅ Store JWT in an HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true,  
      secure: process.env.NODE_ENV === "production", // ✅ Secure in production
      sameSite: "Strict",  // ✅ Better CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000, 
    });

    // Send user details (excluding password)
    res.json({
      message: "Login successful",
      user: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        is_verified: userData.is_verified,
        dob: userData.dob,
        gender: userData.gender,
        image: userData.image || null, 
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};


// Forgot Password (Send OTP)
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000); // Generate OTP
    await pool.query('UPDATE users SET otp = $1 WHERE email = $2', [otp, email]);

    await sendEmail(email, 'Reset Password', `Your OTP to reset password: ${otp}`);
    res.json({ message: 'Password reset OTP sent to your email' });
  } catch (error) {
    res.status(500).json({ error: 'Error sending reset link' });
  }
};

// Reset Password with OTP
exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    if (user.rows[0].otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1, otp = NULL WHERE email = $2', [hashedPassword, email]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Error resetting password' });
  }
};

exports.updateAccount = async (req, res) => {
  try {
    const { email, name, dob, gender } = req.body;
    const image = req.file ? req.file.buffer.toString("base64") : null; // Convert image to Base64

    console.log("Received Image:", image ? "Yes" : "No");

    // Check if user exists
    const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: "User not found" });

    // Ensure user is verified
    if (!user.rows[0].is_verified) {
      return res.status(403).json({ error: "Please verify your email first" });
    }

    // Update user details
    if (name) {
      await pool.query("UPDATE users SET name = $1 WHERE email = $2", [name, email]);
    }

    // Update profile details
    await pool.query(
      `INSERT INTO user_profiles (email, dob, gender, image)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) 
       DO UPDATE SET dob = COALESCE($2, user_profiles.dob), 
                     gender = COALESCE($3, user_profiles.gender), 
                     image = COALESCE($4, user_profiles.image)`,
      [email, dob, gender, image]
    );

    res.json({ message: "Account updated successfully" });
  } catch (error) {
    console.error("Error updating account:", error);
    res.status(500).json({ error: "Error updating account" });
  }
};

exports.checkAuth = async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
  
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userQuery = `
  SELECT 
    u.id, u.name, u.email, u.is_verified,
    p.dob, p.gender, p.image
  FROM users u
  LEFT JOIN user_profiles p ON u.email = p.email
  WHERE u.id = $1
`;

const user = await pool.query(userQuery, [decoded.userId]);
  
    if (user.rows.length === 0) return res.status(401).json({ error: "Invalid token" });
  
    res.json({ user: user.rows[0] });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    console.error("Auth check error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
};

exports.logout = (req, res) => {
  res.clearCookie("token"); // ✅ Remove JWT
  res.json({ message: "Logged out successfully" });
};

