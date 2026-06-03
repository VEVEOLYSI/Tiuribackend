import { serve } from '@hono/node-server';
import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server started`, { port: info.port, env: env.NODE_ENV });
  logger.info(`Health : http://localhost:${info.port}/health`);
  logger.info(`Metrics: http://localhost:${info.port}/metrics`);
  logger.info(`API    : http://localhost:${info.port}/api/v1`);
});

const shutdown = () => {
  logger.info('Shutting down...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
