
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { env } from 'hono/adapter';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';

import views from '../views';
import { whatsappWebhook } from './api/whatsapp';
import { PostgresStore } from "@mastra/pg";


const storage = new PostgresStore({
  id: 'pg-storage',
  connectionString: process.env.DATABASE_URL,
});

await storage.init();

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    // Enables DefaultExporter and CloudExporter for tracing
    default: { enabled: true },
  }),
  server: {
    middleware: [],
    apiRoutes: [
      ...views,
      whatsappWebhook,
    ]
  }
});
