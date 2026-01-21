import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';
import { UserProfile } from '../types/UserProfile';
import { GoblInvoiceSchema } from './extract-ticket-invoice-tool';

const logger = new PinoLogger({
  name: 'UpdateExpenseTool',
  level: 'info',
});

export const updateExpenseTool = createTool({
  id: 'update-expense',
  description: `Actualiza los datos de un gasto ya registrado en la tabla expenses_invoices.
  Úsala cuando el usuario corrija algún dato del ticket/factura (importe, fecha, proveedor, CIF, tipo de IVA, etc.).`,
  inputSchema: z.object({
    expenseId: z
      .string()
      .uuid()
      .describe('ID del gasto (registro de expenses_invoices) que se quiere actualizar'),
    // Atajo para campos frecuentes (mantener compatibilidad)
    issueDate: z
      .string()
      .optional()
      .describe('Nueva fecha de la factura/ticket en formato YYYY-MM-DD'),
    currency: z
      .string()
      .optional()
      .describe('Nueva moneda (por ejemplo, EUR)'),
    supplierName: z
      .string()
      .optional()
      .describe('Nuevo nombre del proveedor/emisor'),
    taxCode: z
      .string()
      .optional()
      .describe('Nuevo CIF/NIF del emisor (supplier.tax_id.code)'),
    totalAmount: z
      .number()
      .optional()
      .describe('Nuevo importe total pagado'),
    ivaRatePercent: z
      .number()
      .optional()
      .describe('Nuevo tipo de IVA aplicado al gasto, en porcentaje (por ejemplo, 21 para 21%)'),
    // Permite actualizar cualquier campo del objeto GOBL completo
    goblInvoice: GoblInvoiceSchema.partial()
      .optional()
      .describe(
        'Objeto factura GOBL parcial o completo con los campos a sobrescribir dentro de gobl_invoice.',
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    updatedFields: z.array(z.string()).optional(),
    expense: z
      .object({
        id: z.string(),
        supplierName: z.string().nullable().optional(),
        issueDate: z.string().nullable().optional(),
        currency: z.string().nullable().optional(),
        totalAmount: z.number().nullable().optional(),
        ivaRatePercent: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
  execute: async (input, context) => {
    const profile = context?.requestContext?.get('profile') as UserProfile | undefined;

    if (!profile) {
      return {
        success: false,
        message: 'No se pudo identificar al usuario para actualizar el gasto.',
        updatedFields: [],
        expense: null,
      };
    }

    const {
      expenseId,
      issueDate,
      currency,
      supplierName,
      taxCode,
      totalAmount,
      ivaRatePercent,
    } = input;

    try {
      // 1. Obtener el gasto actual y verificar que pertenece al usuario
      const { data: existing, error: fetchError } = await supabase
        .from('expenses_invoices')
        .select('id, profile_id, gobl_invoice, iva_rate_percent')
        .eq('id', expenseId)
        .eq('profile_id', profile.id)
        .single();

      if (fetchError || !existing) {
        logger.warn('Expense not found or not owned by profile', {
          expenseId,
          profileId: profile.id,
          error: fetchError?.message,
        });
        return {
          success: false,
          message: 'No he encontrado ese gasto o no está asociado a tu usuario.',
          updatedFields: [],
          expense: null,
        };
      }

      let invoice = (existing as any).gobl_invoice || {};
      const updatedFields: string[] = [];

      // 2. Aplicar cambios sobre el JSON de la factura
      // 2. Si se pasa un objeto goblInvoice, hacemos un merge profundo sobre el existente
      if (input.goblInvoice) {
        // Validamos/parcheamos solo los campos permitidos por el esquema GOBL
        const patch = GoblInvoiceSchema.partial().parse(input.goblInvoice);

        const deepMerge = (target: any, source: any): any => {
          if (source === null || source === undefined) return target;
          if (typeof source !== 'object' || Array.isArray(source)) {
            return source;
          }
          if (typeof target !== 'object' || Array.isArray(target)) {
            target = {};
          }
          for (const key of Object.keys(source)) {
            const value = (source as any)[key];
            if (Array.isArray(value)) {
              (target as any)[key] = value;
            } else if (value && typeof value === 'object') {
              (target as any)[key] = deepMerge((target as any)[key], value);
            } else {
              (target as any)[key] = value;
            }
          }
          return target;
        };

        invoice = deepMerge(invoice, patch);
        updatedFields.push('goblInvoice');
      }

      // 3. Aplicar cambios de los atajos sobre el JSON de la factura
      if (issueDate) {
        (invoice as any).issue_date = issueDate;
        updatedFields.push('issueDate');
      }

      if (currency) {
        (invoice as any).currency = currency;
        updatedFields.push('currency');
      }

      if (supplierName) {
        if (!(invoice as any).supplier) {
          (invoice as any).supplier = {};
        }
        (invoice as any).supplier.name = supplierName;
        updatedFields.push('supplierName');
      }

      if (taxCode) {
        if (!(invoice as any).supplier) {
          (invoice as any).supplier = {};
        }
        if (!(invoice as any).supplier.tax_id) {
          (invoice as any).supplier.tax_id = { country: 'ES' };
        }
        if (!(invoice as any).supplier.tax_id.country) {
          (invoice as any).supplier.tax_id.country = 'ES';
        }
        (invoice as any).supplier.tax_id.code = taxCode;
        updatedFields.push('taxCode');
      }

      if (totalAmount !== undefined) {
        if (!(invoice as any).totals) {
          (invoice as any).totals = {};
        }
        // GOBL usa strings para importes monetarios
        (invoice as any).totals.payable = totalAmount.toFixed(2);
        updatedFields.push('totalAmount');
      }

      let newIvaRatePercent: number | null = null;
      if (ivaRatePercent !== undefined) {
        if (!(invoice as any).totals) {
          (invoice as any).totals = {};
        }
        // Intentamos actualizar la primera categoría/tasa de IVA según el esquema GOBL
        const totals = (invoice as any).totals;
        if (!totals.taxes) {
          totals.taxes = {};
        }
        if (!Array.isArray(totals.taxes.categories)) {
          totals.taxes.categories = [];
        }
        if (!totals.taxes.categories[0]) {
          totals.taxes.categories[0] = {
            code: 'VAT',
            rates: [],
            base: '0',
            amount: '0',
          };
        }
        const firstCategory = totals.taxes.categories[0];
        if (!Array.isArray(firstCategory.rates)) {
          firstCategory.rates = [];
        }
        if (!firstCategory.rates[0]) {
          firstCategory.rates[0] = {
            key: 'standard',
            base: '0',
            percent: '',
            amount: '0',
          };
        }
        firstCategory.rates[0].percent = `${ivaRatePercent}%`;

        newIvaRatePercent = ivaRatePercent;
        updatedFields.push('ivaRatePercent');
      } else if (typeof (existing as any).iva_rate_percent === 'number') {
        newIvaRatePercent = (existing as any).iva_rate_percent;
      }

      // 3. Guardar cambios en Supabase
      const updatePayload: any = {
        gobl_invoice: invoice,
      };

      if (newIvaRatePercent !== null) {
        updatePayload.iva_rate_percent = newIvaRatePercent;
      }

      const { data: updated, error: updateError } = await supabase
        .from('expenses_invoices')
        .update(updatePayload)
        .eq('id', expenseId)
        .eq('profile_id', profile.id)
        .select('id, gobl_invoice, iva_rate_percent')
        .single();

      if (updateError || !updated) {
        logger.error('Error updating expense', { error: updateError?.message, expenseId });
        return {
          success: false,
          message: 'Ha ocurrido un error al actualizar el gasto.',
          updatedFields: [],
          expense: null,
        };
      }

      const updatedInvoice = (updated as any).gobl_invoice || {};

      const finalSupplierName =
        updatedInvoice?.supplier?.name ??
        updatedInvoice?.supplier?.party?.name ??
        null;

      const finalIssueDate = updatedInvoice?.issue_date ?? null;
      const finalCurrency = updatedInvoice?.currency ?? null;

      let finalTotalAmount: number | null = null;
      if (typeof updatedInvoice?.totals?.payable === 'string') {
        finalTotalAmount = parseFloat(updatedInvoice.totals.payable);
      } else if (typeof updatedInvoice?.totals?.payable === 'number') {
        finalTotalAmount = updatedInvoice.totals.payable;
      } else if (typeof updatedInvoice?.totals?.total_with_tax === 'string') {
        finalTotalAmount = parseFloat(updatedInvoice.totals.total_with_tax);
      } else if (typeof updatedInvoice?.totals?.total_with_tax === 'number') {
        finalTotalAmount = updatedInvoice.totals.total_with_tax;
      } else if (typeof updatedInvoice?.totals?.sum === 'string') {
        finalTotalAmount = parseFloat(updatedInvoice.totals.sum);
      } else if (typeof updatedInvoice?.totals?.sum === 'number') {
        finalTotalAmount = updatedInvoice.totals.sum;
      }

      let finalIvaRatePercent: number | null = null;
      if (typeof (updated as any).iva_rate_percent === 'number') {
        finalIvaRatePercent = (updated as any).iva_rate_percent;
      } else {
        const percentStr: string | undefined =
          updatedInvoice?.totals?.taxes?.categories?.[0]?.rates?.[0]?.percent;
        if (typeof percentStr === 'string') {
          const cleaned = percentStr.replace('%', '').trim();
          const parsed = parseFloat(cleaned);
          finalIvaRatePercent = Number.isFinite(parsed) ? parsed : null;
        }
      }

      return {
        success: true,
        message:
          updatedFields.length > 0
            ? `Gasto actualizado correctamente (${updatedFields.join(', ')}).`
            : 'No se ha cambiado ningún dato del gasto.',
        updatedFields,
        expense: {
          id: updated.id as string,
          supplierName: finalSupplierName,
          issueDate: finalIssueDate,
          currency: finalCurrency,
          totalAmount: finalTotalAmount,
          ivaRatePercent: finalIvaRatePercent,
        },
      };
    } catch (err: any) {
      logger.error('Exception updating expense', { error: err, expenseId });
      return {
        success: false,
        message: 'Ha ocurrido un error inesperado al actualizar el gasto.',
        updatedFields: [],
        expense: null,
      };
    }
  },
});

