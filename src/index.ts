import dotenv from 'dotenv';
import { app } from './app';
import { logger } from '@/utils/logger';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 4000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 CoachMate API Server started`);
  logger.info(`📍 Environment: ${NODE_ENV}`);
  logger.info(`🌐 Server running on port ${PORT}`);
  logger.info(`📡 API URL: http://localhost:${PORT}/api/${process.env.API_VERSION || 'v1'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});
