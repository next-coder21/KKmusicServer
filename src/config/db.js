const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.connect()
  .then(() => console.log('PostgreSQL Connected'))
  .catch(err => console.error('Database Connection Error', err));

module.exports = pool;
