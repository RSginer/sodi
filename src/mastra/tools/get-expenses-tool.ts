import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';
import { UserProfile } from '../types/UserProfile';

const logger = new PinoLogger({
  name: 'GetExpensesTool',
  level: 'info',
});

export const getExpensesTool = createTool({
  id: 'get-expenses',
  description: `Obtiene la lista de gastos (tickets/facturas) registrados del usuario desde la tabla expenses_invoices.
  Usa esta tool cuando el usuario quiera ver, revisar o resumir sus gastos ya registrados.`,
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .default(20)
      .describe('Número máximo de gastos a devolver, ordenados del más reciente al más antiguo'),
  }).optional(),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    expenses: z
      .array(
        z.object({
          id: z.string().describe('Identificador del gasto'),
          createdAt: z
            .string()
            .describe('Fecha de creación del registro en la base de datos (ISO 8601)'),
          supplierName: z
            .string()
            .nullable()
            .optional()
            .describe('Nombre del proveedor/emisor si está disponible en la factura GOBL'),
          issueDate: z
            .string()
            .nullable()
            .optional()
            .describe('Fecha de la factura/ticket si está disponible'),
          currency: z
            .string()
            .nullable()
            .optional()
            .describe('Moneda del gasto (por ejemplo, EUR)'),
          totalAmount: z
            .number()
            .nullable()
            .optional()
            .describe('Importe total pagado si está disponible'),
          ivaRatePercent: z
            .number()
            .nullable()
            .optional()
            .describe('Tipo de IVA aplicado al gasto, en porcentaje'),
        }),
      )
      .describe('Lista de gastos del usuario'),
  }),
  execute: async (input, context) => {
    const profile = context?.requestContext?.get('profile') as UserProfile | undefined;

    if (!profile) {
      return {
        success: false,
        message: 'No se pudo identificar al usuario para obtener sus gastos.',
        expenses: [],
      };
    }

    const limit = input?.limit ?? 20;

    try {
      const { data, error } = await supabase
        .from('expenses_invoices')
        .select('id, created_at, gobl_invoice, iva_rate_percent')
        .eq('profile_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('Error fetching expenses invoices', { error: error.message });
        return {
          success: false,
          message: 'Ha ocurrido un error al obtener tus gastos.',
          expenses: [],
        };
      }

      const expenses =
        data?.map((row: any) => {
          const invoice = row.gobl_invoice || {};

          const supplierName =
            invoice?.supplier?.name ??
            invoice?.supplier?.party?.name ??
            null;

          const issueDate = invoice?.issue_date ?? null;
          const currency = invoice?.currency ?? null;

          let totalAmount: number | null = null;
          if (typeof invoice?.totals?.payable === 'number') {
            totalAmount = invoice.totals.payable;
          } else if (typeof invoice?.totals?.sum === 'number') {
            totalAmount = invoice.totals.sum;
          }

          const ivaRatePercent =
            typeof row.iva_rate_percent === 'number'
              ? row.iva_rate_percent
              : typeof invoice?.totals?.iva_rate_percent === 'number'
                ? invoice.totals.iva_rate_percent
                : null;

          return {
            id: row.id as string,
            createdAt: row.created_at as string,
            supplierName,
            issueDate,
            currency,
            totalAmount,
            ivaRatePercent,
          };
        }) ?? [];

      if (expenses.length === 0) {
        return {
          success: true,
          message: 'Todavía no tienes ningún gasto registrado.',
          expenses: [],
        };
      }

      return {
        success: true,
        message: `Se han encontrado ${expenses.length} gasto(s) registrado(s).`,
        expenses,
      };
    } catch (err: any) {
      logger.error('Exception fetching expenses invoices', { error: err });
      return {
        success: false,
        message: 'Ha ocurrido un error inesperado al obtener tus gastos.',
        expenses: [],
      };
    }
  },
});

