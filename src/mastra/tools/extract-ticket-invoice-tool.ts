import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';
import { UserProfile } from '../types/UserProfile';

const logger = new PinoLogger({
  name: 'ExtractTicketInvoiceTool',
  level: 'info',
});

// Minimal Zod schema to ensure required GOBL Invoice fields exist
// and to document each property.
const GoblInvoiceSchema = z.object({
  type: z
    .string()
    .describe('Tipo de factura GOBL, normalmente \"standard\" para un ticket/factura simplificada.'),
  issue_date: z
    .string()
    .describe('Fecha de expedición de la factura en formato YYYY-MM-DD.'),
  currency: z
    .string()
    .describe('Código de moneda ISO 4217, por ejemplo \"EUR\".'),
  supplier: z
    .any()
    .describe('Objeto del emisor (supplier) según GOBL; debe incluir al menos name y tax_id.code (CIF/NIF del emisor).'),
  totals: z
    .any()
    .describe('Objeto de totales de la factura según GOBL, con importe total y desglose de IVA si está disponible.'),
}).passthrough();

// Structured output JSON schema passed to OpenAI so it returns
// a well-formed GOBL Invoice-shaped object.
const goblInvoiceJsonSchema = {
  name: 'gobl_invoice',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string' },
      issue_date: { type: 'string' },
      currency: { type: 'string' },
      supplier: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          tax_id: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // País del emisor; en nuestro caso siempre \"ES\" (España)
              country: { type: 'string', enum: ['ES'] },
              code: { type: 'string' },
            },
            // Ambos campos son requeridos por el esquema
            required: ['country', 'code'],
          },
        },
        // name y tax_id son obligatorios según el esquema
        required: ['name', 'tax_id'],
      },
      totals: {
        type: 'object',
        additionalProperties: false,
        properties: {
          payable: { type: 'number' },
          sum: { type: 'number' },
          // IVA percentage (e.g. 21 for 21%)
          iva_rate_percent: { type: 'number' },
        },
        // Todos los campos definidos en properties son requeridos según la validación de OpenAI
        required: ['payable', 'sum', 'iva_rate_percent'],
      },
    },
    required: ['type', 'issue_date', 'currency', 'supplier', 'totals'],
  },
} as const;

export const extractTicketInvoiceTool = createTool({
  id: 'extract-ticket-invoice',
  description: `Given an image URL of an expense ticket or invoice, uses an OpenAI vision-capable model to extract a GOBL Invoice JSON (https://gobl.org/draft-0/bill/invoice) and saves it into the expenses_invoices table.`,
  inputSchema: z.object({
    imageUrl: z.string().url().describe('Public URL of the ticket image to analyse'),
  }),
  outputSchema: z.object({
    success: z
      .boolean()
      .describe('Indica si el ticket se ha leído y guardado correctamente.'),
    message: z
      .string()
      .describe('Mensaje corto explicando el resultado de la extracción.'),
    invoice: GoblInvoiceSchema.nullable().describe(
      'Objeto factura GOBL extraída del ticket, o null si no se pudo generar una factura válida.'
    ),
    supplierName: z
      .string()
      .nullable()
      .optional()
      .describe('Nombre del proveedor/emisor extraído de invoice.supplier.'),
    issueDate: z
      .string()
      .nullable()
      .optional()
      .describe('Fecha de expedición de la factura (issue_date).'),
    currency: z
      .string()
      .nullable()
      .optional()
      .describe('Moneda principal de la factura (currency).'),
    totalAmount: z
      .number()
      .nullable()
      .optional()
      .describe('Importe total pagado según los totales de la factura.'),
    taxCode: z
      .string()
      .nullable()
      .optional()
      .describe('CIF/NIF del emisor (supplier.tax_id.code).'),
  }),
  execute: async (input, context) => {
    const profile = context?.requestContext?.get('profile') as UserProfile | undefined;

    if (!profile) {
      return {
        success: false,
        message: 'No se pudo identificar al usuario para asociar el ticket',
        invoice: null,
      };
    }

    const { imageUrl } = input;

    const systemPrompt = `
Eres un extractor especializado de tickets y facturas de gastos.
Recibirás una imagen de un ticket o factura (gasto) y debes devolver EXCLUSIVAMENTE un JSON válido que siga lo mejor posible el esquema GOBL Invoice: https://gobl.org/draft-0/bill/invoice

Debes devolver un objeto JSON con las siguientes propiedades principales:
- type: Tipo de factura GOBL, normalmente \"standard\" para un ticket/factura simplificada.
- issue_date: Fecha de expedición de la factura en formato YYYY-MM-DD.
- currency: Código de moneda ISO 4217, por ejemplo \"EUR\".
- supplier: Objeto del emisor (supplier) según GOBL; debe incluir al menos name y tax_id.code (CIF/NIF del emisor).
- totals: Objeto de totales de la factura según GOBL, con importe total y desglose de IVA si está disponible.

Reglas IMPORTANTES:
- Si un campo no se puede leer, ponlo a null u omítelo. NO inventes datos.
- Es especialmente importante leer el CIF/NIF de la empresa y ponerlo en supplier.tax_id.code.
- Completa al menos estos campos requeridos:
  - type (por defecto "standard" si no está claro)
  - issue_date (fecha del ticket si se ve, en formato YYYY-MM-DD)
  - currency (por defecto \"EUR\" si está en España y no se indica otra)
  - supplier (con al menos name y, si es posible, tax_id.code)
  - totals (con al menos total y tax breakdown si se ve)
  - iva_rate_percent (tipo de IVA aplicado al ticket en porcentaje, por ejemplo 21 para 21%)
  
- Devuelve SOLO el objeto JSON, sin texto adicional alrededor.
`.trim();

    const userPrompt = `
Analiza esta imagen de ticket/factura de gasto y devuelve un JSON que siga el esquema GOBL Invoice lo mejor posible.
`.trim();

    let rawResponse: any;
    let goblInvoice: any;

    try {
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY no está configurada');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          // Structured output: enforce the expected JSON shape
          response_format: {
            type: 'json_schema',
            json_schema: goblInvoiceJsonSchema,
          },
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl },
                },
              ],
            },
          ],
        }),
      });

      rawResponse = await response.json();

      if (!response.ok) {
        logger.error('OpenAI API error', { status: response.status, body: rawResponse });
        throw new Error(`Error de OpenAI: ${response.status}`);
      }

      const content = rawResponse?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Respuesta de OpenAI vacía');
      }

      // With response_format json_schema, content should already be a JSON string
      const parsed = JSON.parse(content);
      goblInvoice = GoblInvoiceSchema.parse(parsed);
    } catch (error: any) {
      logger.error('Error extracting GOBL invoice from ticket', { error });
      return {
        success: false,
        message: 'No he podido leer correctamente los datos del ticket. Por favor, envíame una foto más clara o diferente.',
        invoice: null,
      };
    }

    // Extract IVA rate percent if present in totals
    const ivaRatePercent: number | null =
      typeof goblInvoice?.totals?.iva_rate_percent === 'number'
        ? goblInvoice.totals.iva_rate_percent
        : null;

    // Insert into Supabase
    try {
      const { error } = await supabase
        .from('expenses_invoices')
        .insert({
          profile_id: profile.id,
          source_image_url: imageUrl,
          gobl_invoice: goblInvoice,
          raw_ocr: rawResponse,
          iva_rate_percent: ivaRatePercent,
        });

      if (error) {
        logger.error('Error inserting expenses invoice', { error: error.message });
        return {
          success: false,
          message: 'He leído el ticket pero no he podido guardarlo en la base de datos.',
          invoice: goblInvoice,
        };
      }
    } catch (error: any) {
      logger.error('Exception inserting expenses invoice', { error });
      return {
        success: false,
        message: 'He leído el ticket pero no he podido guardarlo en la base de datos.',
        invoice: goblInvoice,
      };
    }

    // Build a small summary for the agent to confirm to the user
    const supplierName =
      (goblInvoice?.supplier?.name as string | undefined) ??
      (goblInvoice?.supplier?.party?.name as string | undefined) ??
      null;

    const issueDate = goblInvoice?.issue_date ?? null;
    const currency = goblInvoice?.currency ?? null;

    const taxCode =
      (goblInvoice?.supplier?.tax_id?.code as string | undefined) ??
      null;

    let totalAmount: number | null = null;
    if (typeof goblInvoice?.totals?.payable === 'number') {
      totalAmount = goblInvoice.totals.payable;
    } else if (typeof goblInvoice?.totals?.sum === 'number') {
      totalAmount = goblInvoice.totals.sum;
    }

    return {
      success: true,
      message: 'Ticket de gasto leído y guardado correctamente.',
      invoice: goblInvoice,
      supplierName,
      issueDate,
      currency,
      totalAmount,
      taxCode,
    };
  },
});

