const Redis = require('ioredis');

let _client = null;
let _available = false;

function getRedis() {
  if (_client) return _client;

  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  _client = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  _client.on('connect', () => {
    _available = true;
    console.log('[Redis] connected');
  });

  _client.on('error', (err) => {
    if (_available) console.error('[Redis] error:', err.message);
    _available = false;
  });

  _client.on('close', () => { _available = false; });

  _client.connect().catch(() => {});

  return _client;
}

function isRedisAvailable() { return _available; }

module.exports = { getRedis, isRedisAvailable };
