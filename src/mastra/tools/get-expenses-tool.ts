import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';
import { UserProfile } from '../types/UserProfile';
import { GoblInvoiceSchema } from './extract-ticket-invoice-tool';

const logger = new PinoLogger({
  name: 'GetExpensesTool',
  level: 'info',
});

export const getExpensesTool = createTool({
  id: 'get-expenses',
  description: `Obtiene la lista de gastos (tickets/facturas) registrados del usuario desde la tabla expenses_invoices.
  Usa esta tool cuando el usuario quiera ver, revisar o resumir sus gastos ya registrados.
  También puedes pasar un rango de fechas (fromDate, toDate) en formato YYYY-MM-DD para filtrar por la fecha de la factura (issue_date),
  por ejemplo "este mes" o "entre dos fechas".`,
  inputSchema: z
    .object({
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .default(20)
        .describe('Número máximo de gastos a devolver, ordenados del más reciente al más antiguo'),
      fromDate: z
        .string()
        .optional()
        .describe('Fecha de inicio (incluida) del rango en formato YYYY-MM-DD, aplicada sobre la fecha de la factura (issue_date)'),
      toDate: z
        .string()
        .optional()
        .describe('Fecha de fin (incluida) del rango en formato YYYY-MM-DD, aplicada sobre la fecha de la factura (issue_date)'),
    })
    .optional(),
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
          goblInvoice: GoblInvoiceSchema.nullable().describe(
            'Objeto factura GOBL completo tal y como está guardado en la base de datos.',
          ),
          sourceImageUrl: z
            .string()
            .nullable()
            .optional()
            .describe('URL de la imagen original del ticket/factura, si está disponible.'),
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
    const fromDate = input?.fromDate;
    const toDate = input?.toDate;

    try {
      let query = supabase
        .from('expenses_invoices')
        .select('id, created_at, gobl_invoice, source_image_url')
        .eq('profile_id', profile.id);

      if (fromDate) {
        // Filtramos por la fecha de la factura (issue_date) almacenada en el JSON gobl_invoice
        // Usamos la expresión de columna JSON ->> para compararla como texto YYYY-MM-DD
        query = query.gte('gobl_invoice->>issue_date', fromDate);
      }

      if (toDate) {
        query = query.lte('gobl_invoice->>issue_date', toDate);
      }

      const { data, error } = await query
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
          const supplier = invoice?.supplier || {};

          const supplierName =
            (supplier.name as string | undefined) ??
            (supplier.party?.name as string | undefined) ??
            null;

          const issueDate = (invoice?.issue_date as string | undefined) ?? null;
          const currency = (invoice?.currency as string | undefined) ?? null;

          // Total importe: usamos payable, luego total_with_tax, luego sum (todas strings según GOBL)
          let totalAmount: number | null = null;
          const totals = invoice?.totals;
          if (totals) {
            if (typeof totals.payable === 'string') {
              totalAmount = parseFloat(totals.payable);
            } else if (typeof totals.payable === 'number') {
              totalAmount = totals.payable;
            } else if (typeof totals.total_with_tax === 'string') {
              totalAmount = parseFloat(totals.total_with_tax);
            } else if (typeof totals.total_with_tax === 'number') {
              totalAmount = totals.total_with_tax;
            } else if (typeof totals.sum === 'string') {
              totalAmount = parseFloat(totals.sum);
            } else if (typeof totals.sum === 'number') {
              totalAmount = totals.sum;
            }
          }


          return {
            id: row.id as string,
            createdAt: row.created_at as string,
            goblInvoice: invoice,
            sourceImageUrl: (row.source_image_url as string | undefined) ?? null,
            supplierName,
            issueDate,
            currency,
            totalAmount,
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

