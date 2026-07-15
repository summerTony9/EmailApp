import 'dotenv/config';
import { buildApp } from './app.js';

const app = buildApp();
const host = process.env.MAILER_HOST || process.env.HOST || '0.0.0.0';
const port = Number(process.env.MAILER_PORT || process.env.PORT || 8090);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
