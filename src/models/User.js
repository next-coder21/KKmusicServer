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
    await pool.query(userTableQuery);
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
