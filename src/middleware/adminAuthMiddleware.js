const jwt = require("jsonwebtoken");

exports.adminAuthMiddleware = (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) return res.status(401).json({ error: "Unauthorized Admin Access" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: "Forbidden: Not an admin" });
    }
    req.admin = decoded; 
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
};
