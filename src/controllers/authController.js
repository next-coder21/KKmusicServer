const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/User');
const { sendEmail } = require('../utils/email');
const multer = require("multer");
require('dotenv').config();

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPEG, PNG, or WebP images are allowed"));
  },
});

const cookieOptions = () => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
  maxAge:   7 * 24 * 60 * 60 * 1000,
});

// ─── Register ───────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ error: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Valid email is required' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0)
      return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await pool.query(
      'INSERT INTO users (name, email, password, otp, otp_expires_at) VALUES ($1, $2, $3, $4, $5)',
      [name.trim(), email.toLowerCase(), hashedPassword, otp, otpExpiresAt]
    );

    try {
      await sendEmail(
        email,
        'Verify your Muves account',
        `Your OTP: ${otp}`,
        `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;">
          <h2 style="color:#6c5ce7">Verify your email</h2>
          <p>Your one-time verification code:</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#6c5ce7;padding:16px 0">${otp}</div>
          <p style="color:#888;font-size:13px">This code expires in 30 minutes.</p>
        </div>`
      );
    } catch (emailErr) {
      console.error('Register: failed to send verification email:', emailErr);
      await pool.query('DELETE FROM users WHERE email = $1', [email]);
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }

    res.status(201).json({ message: 'Registration successful. Check your email for the OTP.' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error registering user' });
  }
};

// ─── Verify Email ────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'Invalid email' });

    const row = user.rows[0];
    if (row.otp_expires_at && new Date(row.otp_expires_at) < new Date())
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    if (String(row.otp) !== String(otp))
      return res.status(400).json({ error: 'Invalid OTP' });

    await pool.query('UPDATE users SET is_verified = TRUE, otp = NULL, otp_expires_at = NULL WHERE email = $1', [email.toLowerCase()]);
    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Verification failed' });
  }
};

// ─── Resend OTP ──────────────────────────────────────────────────────────────
exports.resendOtp = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'User not found' });
    if (user.rows[0].is_verified) return res.status(400).json({ error: 'Email already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await pool.query('UPDATE users SET otp = $1, otp_expires_at = $2 WHERE email = $3', [otp, otpExpiresAt, email.toLowerCase()]);

    try {
      await sendEmail(
        email,
        'Your new verification OTP',
        `Your new OTP: ${otp}`,
        `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;">
          <h2 style="color:#6c5ce7">New Verification Code</h2>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#6c5ce7;padding:16px 0">${otp}</div>
          <p style="color:#888;font-size:13px">This code expires in 30 minutes.</p>
        </div>`
      );
    } catch (emailErr) {
      console.error('ResendOtp: failed to send email:', emailErr);
      return res.status(500).json({ error: 'Failed to send OTP email. Please try again.' });
    }

    res.json({ message: 'New OTP sent to your email' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
};

// ─── Login ───────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const userQuery = `
      SELECT u.id, u.name, u.email, u.is_verified, u.password, u.is_active,
             p.dob, p.gender, p.image
      FROM users u
      LEFT JOIN user_profiles p ON u.email = p.email
      WHERE u.email = $1
    `;
    const result = await pool.query(userQuery, [email]);

    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid email or password" });

    const userData = result.rows[0];

    if (userData.is_active === false)
      return res.status(403).json({ error: "Account disabled" });

    if (!userData.is_verified)
      return res.status(403).json({ error: "Please verify your email first" });

    const validPassword = await bcrypt.compare(password, userData.password);
    if (!validPassword)
      return res.status(401).json({ error: "Invalid email or password" });

    // Sign token with id, email, name
    const token = jwt.sign(
      { id: userData.id, email: userData.email, name: userData.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, cookieOptions());

    const { password: _pw, ...safeUser } = userData;
    res.json({
      message: "Login successful",
      token,
      user: { ...safeUser, image: safeUser.image || null },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

// ─── Forgot Password ─────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    // Return generic message to prevent email enumeration
    if (user.rows.length === 0)
      return res.json({ message: 'If that email exists, a reset code has been sent.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await pool.query('UPDATE users SET otp = $1, otp_expires_at = $2 WHERE email = $3', [otp, otpExpiresAt, email.toLowerCase()]);

    try {
      await sendEmail(
        email,
        'Reset your Muves password',
        `Your OTP to reset password: ${otp}`,
        `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;">
          <h2 style="color:#6c5ce7">Reset Password</h2>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#6c5ce7;padding:16px 0">${otp}</div>
          <p style="color:#888;font-size:13px">This code expires in 30 minutes.</p>
        </div>`
      );
    } catch (emailErr) {
      console.error('ForgotPassword: failed to send email:', emailErr);
      return res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
    }

    res.json({ message: 'If that email exists, a reset code has been sent.' });
  } catch (error) {
    res.status(500).json({ error: 'Error sending reset link' });
  }
};

// ─── Reset Password ──────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword)
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'User not found' });

    const row = user.rows[0];
    if (row.otp_expires_at && new Date(row.otp_expires_at) < new Date())
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    if (String(row.otp) !== String(otp))
      return res.status(400).json({ error: 'Invalid OTP' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1, otp = NULL, otp_expires_at = NULL WHERE email = $2', [hashedPassword, email.toLowerCase()]);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Error resetting password' });
  }
};

// ─── Update Account ──────────────────────────────────────────────────────────
exports.updateAccount = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { name, dob, gender } = req.body;
    const image = req.file ? req.file.buffer.toString("base64") : null;

    const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: "User not found" });

    if (name) {
      await pool.query("UPDATE users SET name = $1 WHERE email = $2", [name, email]);
    }

    await pool.query(
      `INSERT INTO user_profiles (email, dob, gender, image)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         dob    = COALESCE($2, user_profiles.dob),
         gender = COALESCE($3, user_profiles.gender),
         image  = COALESCE($4, user_profiles.image)`,
      [email, dob || null, gender || null, image]
    );

    // Return updated user
    const updated = await pool.query(
      `SELECT u.id, u.name, u.email, u.is_verified, p.dob, p.gender, p.image
       FROM users u LEFT JOIN user_profiles p ON u.email = p.email
       WHERE u.email = $1`,
      [email]
    );

    res.json({ message: "Account updated successfully", user: updated.rows[0] });
  } catch (error) {
    console.error("Update account error:", error);
    res.status(500).json({ error: "Error updating account" });
  }
};

// ─── Check Auth ───────────────────────────────────────────────────────────────
exports.checkAuth = async (req, res) => {
  try {
    let token = req.cookies.token;

    // Fallback to Authorization header if cookie is missing (common on cross-site Vercel/Render)
    if (!token && req.headers.authorization) {
      if (req.headers.authorization.startsWith("Bearer ")) {
        token = req.headers.authorization.split(" ")[1];
      }
    }

    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userQuery = `
      SELECT u.id, u.name, u.email, u.is_verified,
             p.dob, p.gender, p.image
      FROM users u
      LEFT JOIN user_profiles p ON u.email = p.email
      WHERE u.id = $1
    `;

    const user = await pool.query(userQuery, [decoded.id]);

    if (user.rows.length === 0) return res.status(401).json({ error: "Invalid token" });

    res.json({ user: user.rows[0] });
  } catch (error) {
    if (error.name === "TokenExpiredError")
      return res.status(401).json({ error: "Session expired. Please log in again." });
    res.status(401).json({ error: "Authentication failed" });
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  const { maxAge, ...clearOpts } = cookieOptions();
  res.clearCookie("token", clearOpts);
  res.json({ message: "Logged out successfully" });
};
