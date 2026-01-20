import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { UserProfile } from '../types/UserProfile';

export const getExpensesViewLinkTool = createTool({
  id: 'get-expenses-view-link',
  description: `Devuelve un enlace web donde el usuario puede ver y filtrar sus gastos (tabla expenses_invoices) en un rango de fechas concreto.
  Usa esta tool cuando el usuario quiera revisar sus gastos en una vista de navegador, por ejemplo para compartirla o verla con más detalle.`,
  inputSchema: z
    .object({
      fromDate: z
        .string()
        .optional()
        .describe('Fecha de inicio (incluida) del rango en formato YYYY-MM-DD.'),
      toDate: z
        .string()
        .optional()
        .describe('Fecha de fin (incluida) del rango en formato YYYY-MM-DD.'),
    })
    .optional(),
  outputSchema: z.object({
    success: z.boolean(),
    url: z
      .string()
      .describe('URL completa a la vista de gastos del usuario, lista para enviar por WhatsApp.'),
    message: z
      .string()
      .describe('Mensaje breve explicando qué contiene el enlace, para que el usuario lo entienda.'),
  }),
  execute: async (input, context) => {
    const profile = context?.requestContext?.get('profile') as UserProfile | undefined;

    if (!profile) {
      return {
        success: false,
        url: '',
        message: 'No se pudo identificar al usuario para generar el enlace de gastos.',
      };
    }

    const baseUrl = process.env.PUBLIC_URL;

    if (!baseUrl) {
      return {
        success: false,
        url: '',
        message: 'No está configurada la URL pública del servidor (PUBLIC_URL).',
      };
    }

    const url = new URL('/expenses', baseUrl);
    url.searchParams.set('profileId', profile.id);

    if (input?.fromDate) {
      url.searchParams.set('fromDate', input.fromDate);
    }

    if (input?.toDate) {
      url.searchParams.set('toDate', input.toDate);
    }

    return {
      success: true,
      url: url.toString(),
      message:
        'Aquí tienes un enlace a tu listado de gastos, donde puedes filtrar por fechas y ver el detalle de tus tickets.',
    };
  },
});

