const pool = require('../config/db');

const createTables = async () => {
  const userTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      is_verified BOOLEAN DEFAULT FALSE,
      otp VARCHAR(6),  -- Stores OTP for email verification & password reset
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const userProfileTableQuery = `
    CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      email VARCHAR(100) UNIQUE NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      dob DATE,
      gender VARCHAR(10) CHECK (gender IN ('Male', 'Female', 'Other')), 
      image TEXT, 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await pool.query(userTableQuery);
    // Add otp_expires_at column to existing deployments that predate this migration
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;
    `).catch(() => {});
    // Add is_active column to existing deployments that predate this migration
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `).catch(() => {});
    console.log('✅ Users table is ready.');

    await pool.query(userProfileTableQuery);
    console.log('✅ User Profiles table is ready.');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};

// Run table creation
createTables();

module.exports = pool;
