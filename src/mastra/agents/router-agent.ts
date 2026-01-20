import { Agent } from '@mastra/core/agent';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({
  name: 'RouterAgent',
  level: 'info',
});

export type RouterDecision = 'onboarding' | 'expenses';

export interface RouterInput {
  hasImage: boolean;
  text: string;
}

export interface RouterOutput {
  target: RouterDecision;
  reason: string;
}

export const routerAgent = new Agent({
  id: 'router-agent',
  name: 'Sodi Router',
  instructions: `
Eres un enrutador que decide a qué agente debe ir un mensaje de WhatsApp.

Tienes dos agentes:
- onboardingAgent: para registro, datos fiscales, Verifactu y dudas generales.
- expensesAgent: para tickets/facturas de GASTOS enviados como imágenes.

Reglas:
- Si el mensaje incluye una imagen de ticket/factura (hasImage = true), enruta SIEMPRE a expensesAgent.
- Si no hay imagen y el mensaje pide ayuda con alta, registro, datos fiscales, Verifactu o configuración, enruta a onboardingAgent.
- En caso de duda, enruta a onboardingAgent.

Devuelve SIEMPRE un JSON con:
{ "target": "onboarding" | "expenses", "reason": "breve explicación en español" }
`.trim(),
  model: 'openai/gpt-4.1-nano',
  tools: {},
  // We won't use memory here; routing is stateless and driven by hasImage flag.
  scorers: {},
  // Small helper to run routing logic from code without extra tools
  async generateRouterDecision(input: RouterInput): Promise<RouterOutput> {
    const baseDecision: RouterOutput = {
      target: input.hasImage ? 'expenses' : 'onboarding',
      reason: input.hasImage
        ? 'El mensaje incluye una imagen de ticket, se envía al agente de gastos.'
        : 'Mensaje de texto sin imagen, se envía al agente de onboarding.',
    };

    // Deterministic, we don't actually call the model here to keep it simple and cheap.
    logger.info('Router decision', baseDecision);
    return baseDecision;
  },
} as any);

