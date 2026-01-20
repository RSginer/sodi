
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import views from '../views';
import { whatsappWebhook } from './api/whatsapp';
import { PostgresStore } from "@mastra/pg";
import { onboardingAgent } from './agents/onboarding-agent';
import { invopopVerifactuWebhook } from './api/invopop';
import { mainAgent } from './agents/main-agent';

export const mastra = new Mastra({
  workflows: {  },
  agents: { 
    onboardingAgent,
    mainAgent,
  },
  scorers: {  },
  storage: new PostgresStore({
    id: 'pg-storage',
    connectionString: process.env.DATABASE_URL,
  }),
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
      invopopVerifactuWebhook,
    ]
  }
});
