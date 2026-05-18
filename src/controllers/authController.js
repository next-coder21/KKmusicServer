const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/User');
const multer = require("multer");
require('dotenv').config();

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
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
  const { name, email, password, securityAnswer } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ error: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Valid email is required' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!securityAnswer || !securityAnswer.trim())
    return res.status(400).json({ error: 'Security keyword is required' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0)
      return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedAnswer = await bcrypt.hash(securityAnswer.trim().toLowerCase(), 10);

    await pool.query(
      'INSERT INTO users (name, email, password, security_answer, is_verified) VALUES ($1, $2, $3, $4, TRUE)',
      [name.trim(), email.toLowerCase(), hashedPassword, hashedAnswer]
    );

    res.status(201).json({ message: 'Account created successfully.' });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error registering user' });
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
      return res.status(403).json({ error: "Account not verified" });

    const validPassword = await bcrypt.compare(password, userData.password);
    if (!validPassword)
      return res.status(401).json({ error: "Invalid email or password" });

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

// ─── Verify Security Answer (for forgot password) ────────────────────────────
exports.verifySecurityAnswer = async (req, res) => {
  const { email, securityAnswer } = req.body;
  if (!email || !securityAnswer)
    return res.status(400).json({ error: 'Email and security keyword are required' });

  try {
    const result = await pool.query(
      'SELECT security_answer FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Use a generic error for both "no account" and "wrong answer" to prevent
    // email-enumeration attacks on the password-reset flow.
    const GENERIC_ERR = 'Invalid email or security keyword';

    if (result.rows.length === 0)
      return res.status(400).json({ error: GENERIC_ERR });

    const storedAnswer = result.rows[0].security_answer;
    if (!storedAnswer)
      return res.status(400).json({ error: GENERIC_ERR });

    const match = await bcrypt.compare(securityAnswer.trim().toLowerCase(), storedAnswer);
    if (!match)
      return res.status(400).json({ error: GENERIC_ERR });

    res.json({ message: 'Security keyword verified' });
  } catch (error) {
    console.error('VerifySecurityAnswer error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

// ─── Reset Password ──────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const { email, securityAnswer, newPassword } = req.body;
  if (!email || !securityAnswer || !newPassword)
    return res.status(400).json({ error: 'Email, security keyword, and new password are required' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const result = await pool.query(
      'SELECT security_answer FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    const GENERIC_RESET_ERR = 'Invalid email or security keyword';

    if (result.rows.length === 0)
      return res.status(400).json({ error: GENERIC_RESET_ERR });

    const storedAnswer = result.rows[0].security_answer;
    const match = await bcrypt.compare(securityAnswer.trim().toLowerCase(), storedAnswer);
    if (!match)
      return res.status(400).json({ error: GENERIC_RESET_ERR });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1 WHERE email = $2',
      [hashedPassword, email.toLowerCase()]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('ResetPassword error:', error);
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
