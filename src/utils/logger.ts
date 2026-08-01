import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: undefined,
  },
  pino.destination({ dest: 2, sync: false }),
);

export default logger;
