require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();

// Required for Render (which is a reverse proxy)
app.set('trust proxy', 1);
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('[Startup] Missing MONGODB_URI environment variable');
  process.exit(1);
}

app.use(helmet());
app.use(compression());

// Production CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/repo', require('./routes/repo'));
app.use('/api/repo', require('./routes/file'));
app.use('/api/projects', require('./routes/projects'));
app.use('/projects', require('./routes/projects'));
app.use('/api/github', require('./routes/github'));
app.use('/github', require('./routes/github'));
app.use('/api/repo', require('./routes/report'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/history', require('./routes/history'));
app.use('/api/reviews', require('./routes/reviews'));
const healthCheckHandler = async (req, res) => {
  let dbStatus = 'disconnected';
  if (mongoose.connection.readyState === 1) {
    dbStatus = 'connected';
  }

  // Check Redis status safely without crashing
  const redisCache = require('./services/redisCache');
  let redisStatus = 'disconnected';
  if (redisCache.isReady()) {
    redisStatus = 'connected';
  }

  res.json({
    status: 'ok',
    database: dbStatus,
    redis: redisStatus,
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
};

app.get('/health', healthCheckHandler);
app.get('/api/health', healthCheckHandler);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Error Handler]', err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errorCode: err.code || 'INTERNAL_ERROR',
    // Strip stack trace in production
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('Connected to MongoDB');
})
.catch(err => {
  console.error('Failed to connect to MongoDB', err);
});

// Initialize Redis Cache Connection
const { initRedis } = require('./services/redisCache');
initRedis();

app.listen(PORT, () => {
  console.log(`Node.js server listening on port ${PORT}`);
});
