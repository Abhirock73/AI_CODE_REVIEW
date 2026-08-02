const { createClient } = require('redis');

const REDIS_URI = process.env.REDIS_URI;

let client = null;
let isConnected = false;

const initRedis = async () => {
  if (!REDIS_URI) {
    console.error('[Redis] Startup Error: No REDIS_URI provided in environment variables.');
    console.warn('[Redis] Application will run without Redis cache. Continuing using MongoDB...');
    return null;
  }

  client = createClient({ url: REDIS_URI });
  
  client.on('error', (err) => {
    console.error('Redis unavailable');
    isConnected = false;
  });
  
  client.on('connect', () => {
    console.log('Redis connected');
    isConnected = true;
  });

  client.on('end', () => {
    console.log('Redis disconnected');
    isConnected = false;
  });

  try {
    await client.connect();
    
    // Startup Verification
    const testKey = '_startup_verification_key';
    const testValue = 'test_value';
    
    await client.set(testKey, testValue, { EX: 10 });
    const readValue = await client.get(testKey);
    
    if (readValue === testValue) {
      await client.del(testKey);
      console.log('Redis connection verified successfully.');
    } else {
      console.warn('[Redis] Verification failed: Data read does not match data written.');
    }

  } catch (err) {
    console.error('[Redis] Connection failed on startup:', err.message);
    console.warn('[Redis] Application will run without Redis cache temporarily.');
    isConnected = false;
    client = null;
  }

  return client;
};

const isReady = () => isConnected;

const getCache = async (key) => {
  if (!isConnected || !client) {
    console.log('Cache SKIPPED');
    console.log('Redis unavailable');
    return null;
  }
  try {
    const data = await client.get(key);
    if (data) {
      console.log('Cache HIT');
      return JSON.parse(data);
    } else {
      console.log('Cache MISS');
      return null;
    }
  } catch (error) {
    console.log('Redis GET failed');
    console.log('Redis cache read failed. Continue directly to LLM.');
    return null;
  }
};

const setCache = async (key, value, expirySeconds = 86400) => {
  if (!isConnected || !client) {
    console.log('Cache SKIPPED');
    console.log('Redis unavailable');
    return;
  }
  try {
    await client.set(key, JSON.stringify(value), { EX: expirySeconds });
  } catch (error) {
    console.log('Redis SET failed');
    console.log('Redis cache write failed.');
  }
};

const delCache = async (key) => {
  if (!isConnected || !client) {
    console.log('Cache SKIPPED');
    console.log('Redis unavailable');
    return;
  }
  try {
    await client.del(key);
  } catch (error) {
    console.log('Redis DEL failed');
  }
};

const expireCache = async (key, expirySeconds) => {
  if (!isConnected || !client) {
    return;
  }
  try {
    await client.expire(key, expirySeconds);
  } catch (error) {
    console.log('Redis EXPIRE failed');
  }
};

const getClient = () => client;

module.exports = {
  initRedis,
  getCache,
  setCache,
  delCache,
  expireCache,
  isReady,
  getClient,
};
