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
// a well-formed GOBL Invoice-shaped object according to https://gobl.org/draft-0/bill/invoice
// Based on the official JSON Schema specification with all required and recommended properties
const goblInvoiceJsonSchema = {
  name: 'gobl_invoice',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Required properties according to GOBL spec
      type: {
        type: 'string',
        enum: ['standard', 'proforma', 'corrective', 'credit-note', 'debit-note', 'other'],
        description: 'Tipo de factura GOBL. Normalmente "standard" para un ticket/factura simplificada.',
      },
      issue_date: {
        type: 'string',
        description: 'Fecha de expedición de la factura en formato YYYY-MM-DD (cal.Date).',
      },
      currency: {
        type: 'string',
        description: 'Código de moneda ISO 4217, por ejemplo "EUR" (currency.Code).',
      },
      supplier: {
        type: 'object',
        additionalProperties: false,
        description: 'Entidad que emite la factura (org.Party). Debe incluir name y tax_id con country y code.',
        properties: {
          name: { type: 'string', description: 'Nombre legal o razón social del emisor.' },
          tax_id: {
            type: 'object',
            additionalProperties: false,
            properties: {
              country: {
                type: 'string',
                enum: ['ES'],
                description: 'Código de país ISO 3166-1 alpha-2 (ej. "ES" para España).',
              },
              code: {
                type: 'string',
                description: 'Código de identificación fiscal normalizado (CIF/NIF sin puntos, espacios ni guiones).',
              },
            },
            required: ['country', 'code'],
          },
          addresses: {
            type: 'array',
            description: 'Array de direcciones del emisor. Puede ser un array vacío [] si no hay direcciones disponibles.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                street: { type: 'string', description: 'Nombre de la calle.' },
                num: { type: 'string', description: 'Número de la dirección.' },
                locality: { type: 'string', description: 'Localidad o ciudad.' },
                region: { type: 'string', description: 'Región o provincia.' },
                code: { type: 'string', description: 'Código postal.' },
                country: { type: 'string', description: 'Código de país.' },
              },
              required: ['street', 'num', 'locality', 'region', 'code', 'country'],
            },
          },
          emails: {
            type: 'array',
            description: 'Array de direcciones de correo electrónico del emisor. Puede ser un array vacío [] si no hay emails disponibles.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                addr: { type: 'string', description: 'Dirección de correo electrónico.' },
              },
              required: ['addr'],
            },
          },
        },
        required: ['name', 'tax_id', 'addresses', 'emails'],
      },
      totals: {
        type: 'object',
        additionalProperties: false,
        description: 'Resumen de todos los totales calculados (bill.Totals).',
        properties: {
          sum: {
            type: 'string',
            description: 'Suma total de líneas después de descuentos, antes de impuestos (como string, ej. "200.00").',
          },
          taxes: {
            type: 'object',
            additionalProperties: false,
            properties: {
              categories: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    code: {
                      type: 'string',
                      enum: ['VAT'],
                      description: 'Código de categoría de impuesto (VAT para IVA en España).',
                    },
                    rates: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          key: {
                            type: 'string',
                            description: 'Clave de la tasa de impuesto (ej. "standard", "reduced", "super-reduced").',
                          },
                          base: {
                            type: 'string',
                            description: 'Base imponible para esta tasa (como string, ej. "200.00").',
                          },
                          percent: {
                            type: 'string',
                            description: 'Porcentaje de la tasa (como string, ej. "21.0%").',
                          },
                          amount: {
                            type: 'string',
                            description: 'Monto del impuesto para esta tasa (como string, ej. "42.00").',
                          },
                        },
                        required: ['key', 'base', 'percent', 'amount'],
                      },
                    },
                    base: {
                      type: 'string',
                      description: 'Base total de la categoría de impuesto (como string).',
                    },
                    amount: {
                      type: 'string',
                      description: 'Monto total de la categoría de impuesto (como string).',
                    },
                  },
                  required: ['code', 'rates', 'base', 'amount'],
                },
              },
              sum: {
                type: 'string',
                description: 'Suma total de todos los impuestos (como string, ej. "42.00").',
              },
            },
            required: ['categories', 'sum'],
          },
          tax: {
            type: 'string',
            description: 'Monto total de impuestos aplicados (como string, ej. "42.00").',
          },
          total_with_tax: {
            type: 'string',
            description: 'Total con impuestos incluidos (como string, ej. "242.00").',
          },
          payable: {
            type: 'string',
            description: 'Importe total a pagar (normalmente igual a total_with_tax, como string, ej. "242.00").',
          },
        },
        required: ['sum', 'taxes', 'tax', 'total_with_tax', 'payable'],
      },
      // Recommended properties according to GOBL spec
      $regime: {
        type: 'string',
        enum: ['ES'],
        description: 'Código del régimen fiscal aplicable (tax.RegimeCode). Para España usar "ES". Si no está disponible, usar "ES" por defecto.',
      },
      series: {
        type: 'string',
        description: 'Serie de la factura para agrupar documentos (cbc.Code). Usar string vacío "" si no está disponible.',
      },
      code: {
        type: 'string',
        description: 'Código secuencial único de la factura (cbc.Code). Requerido para firmar el documento. Usar string vacío "" si no está disponible.',
      },
      lines: {
        type: 'array',
        description: 'Array de líneas de detalle de la factura. Puede ser un array vacío [] si no hay líneas detalladas disponibles.',
        items: {
          type: 'object',
          additionalProperties: false,
          description: 'Línea de detalle de la factura (bill.Line).',
          properties: {
            i: {
              type: 'number',
              description: 'Índice de la línea (1, 2, 3...). Calculado automáticamente si no se proporciona.',
            },
            quantity: {
              type: 'string',
              description: 'Cantidad de unidades del artículo/servicio (como string, ej. "2", "1.5").',
            },
            item: {
              type: 'object',
              additionalProperties: false,
              description: 'Información del artículo/servicio (org.Item).',
              properties: {
                name: {
                  type: 'string',
                  description: 'Nombre del artículo o servicio.',
                },
                price: {
                  type: 'string',
                  description: 'Precio unitario del artículo (como string, ej. "100.00").',
                },
                code: {
                  type: 'string',
                  description: 'Código de referencia del artículo. Usar string vacío "" si no está disponible.',
                },
                description: {
                  type: 'string',
                  description: 'Descripción adicional del artículo. Usar string vacío "" si no está disponible.',
                },
              },
              required: ['name', 'price', 'code', 'description'],
            },
            discounts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  percent: {
                    type: 'string',
                    description: 'Porcentaje de descuento (como string, ej. "10.0%"). Usar string vacío "" si no aplica.',
                  },
                  amount: {
                    type: 'string',
                    description: 'Monto de descuento (como string, ej. "20.00"). Usar string vacío "" si no aplica.',
                  },
                  reason: {
                    type: 'string',
                    description: 'Motivo del descuento. Usar string vacío "" si no hay motivo.',
                  },
                },
                required: ['percent', 'amount', 'reason'],
              },
            },
            taxes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                description: 'Impuesto aplicado a esta línea (bill.Tax).',
                properties: {
                  cat: {
                    type: 'string',
                    enum: ['VAT'],
                    description: 'Categoría de impuesto (VAT para IVA en España).',
                  },
                  rate: {
                    type: 'string',
                    description: 'Clave de la tasa de impuesto (ej. "standard", "reduced", "super-reduced").',
                  },
                  percent: {
                    type: 'string',
                    description: 'Porcentaje de impuesto (como string, ej. "21.0%", "10.0%").',
                  },
                  amount: {
                    type: 'string',
                    description: 'Monto del impuesto para esta línea (como string, calculado). Usar string vacío "" si no está disponible.',
                  },
                },
                required: ['cat', 'rate', 'percent', 'amount'],
              },
            },
            sum: {
              type: 'string',
              description: 'Suma de la línea antes de impuestos (quantity * price - discounts, como string, ej. "200.00").',
            },
            total: {
              type: 'string',
              description: 'Importe total de la línea con impuestos incluidos (como string, ej. "242.00").',
            },
          },
          required: ['i', 'quantity', 'item', 'discounts', 'taxes', 'sum', 'total'],
        },
      },
      // Optional but commonly used properties
      issue_time: {
        type: 'string',
        description: 'Hora de emisión en formato HH:MM:SS (cal.Time, opcional). Usar string vacío "" si no está disponible.',
      },
      customer: {
        type: 'object',
        additionalProperties: false,
        description: 'Entidad que recibe la factura (org.Party, opcional, puede omitirse en facturas simplificadas). Si no está disponible, usar objeto con name y tax_id vacíos.',
        properties: {
          name: { type: 'string', description: 'Nombre del cliente.' },
          tax_id: {
            type: 'object',
            additionalProperties: false,
            properties: {
              country: { type: 'string', enum: ['ES'], description: 'Código de país.' },
              code: { type: 'string', description: 'CIF/NIF del cliente (sin puntos ni espacios).' },
            },
            required: ['country', 'code'],
          },
        },
        required: ['name', 'tax_id'],
      },
      $tags: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['simplified', 'reverse-charge', 'self-billed', 'customer-rates', 'partial', 'bypass'],
        },
        description: 'Etiquetas para identificar escenarios fiscales especiales (ej. "simplified" para facturas simplificadas). Puede ser un array vacío [] si no hay etiquetas.',
      },
    },
    required: [
      'type',
      'issue_date',
      'currency',
      'supplier',
      'totals',
      '$regime',
      'series',
      'code',
      'lines',
      'issue_time',
      'customer',
      '$tags',
    ],
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
    // Líneas tal y como vienen en el JSON GOBL (bill.Line), usando strings para importes
    lines: z
      .array(
        z.object({
          i: z
            .number()
            .optional()
            .describe('Índice de la línea (1, 2, 3...). Puede venir calculado por GOBL.'),
          quantity: z
            .string()
            .describe('Cantidad de la línea como string (por ejemplo "2" o "1.5").'),
          item: z
            .object({
              name: z
                .string()
                .describe('Nombre del artículo o servicio en la línea.'),
              price: z
                .string()
                .describe('Precio unitario del artículo como string (por ejemplo "100.00").'),
            })
            .describe('Objeto item de la línea según org.Item simplificado.'),
          taxes: z
            .array(
              z.object({
                cat: z
                  .string()
                  .describe('Categoría de impuesto (por ejemplo "VAT" para IVA).'),
                rate: z
                  .string()
                  .describe('Clave de la tasa de impuesto (por ejemplo "standard").'),
                percent: z
                  .string()
                  .describe('Porcentaje de IVA como string (por ejemplo "21.0%").'),
                amount: z
                  .string()
                  .optional()
                  .describe('Monto del impuesto de la línea como string, si está disponible.'),
              }),
            )
            .optional()
            .describe('Impuestos aplicados a la línea según bill.Tax.'),
          sum: z
            .string()
            .optional()
            .describe(
              'Suma de la línea antes de impuestos (quantity * price - discounts) como string, si está disponible.',
            ),
          total: z
            .string()
            .describe('Importe total de la línea (normalmente con impuestos) como string.'),
        }),
      )
      .describe(
        'Líneas de la factura extraídas del ticket en formato compatible con GOBL (strings para importes).',
      ),
  }),
  execute: async (input, context) => {
    const profile = context?.requestContext?.get('profile') as UserProfile | undefined;

    if (!profile) {
      return {
        success: false,
        message: 'No se pudo identificar al usuario para asociar el ticket',
        invoice: null,
        supplierName: null,
        issueDate: null,
        currency: null,
        totalAmount: null,
        taxCode: null,
        lines: [],
      };
    }

    const { imageUrl } = input;

    const systemPrompt = `
Eres un extractor especializado de tickets y facturas de gastos.
Recibirás una imagen de un ticket o factura (gasto) y debes devolver EXCLUSIVAMENTE un JSON válido que siga el esquema GOBL Invoice oficial: https://gobl.org/draft-0/bill/invoice

Debes devolver un objeto JSON con las siguientes propiedades según la especificación GOBL:

PROPIEDADES REQUERIDAS (deben estar siempre):
- type: Tipo de factura ("standard", "proforma", "corrective", "credit-note", "debit-note", "other"). Normalmente "standard" para tickets.
- issue_date: Fecha de expedición en formato YYYY-MM-DD.
- currency: Código de moneda ISO 4217 (ej. "EUR").
- supplier: Objeto org.Party del emisor con:
  - name: Nombre legal o razón social
  - tax_id: Objeto con country ("ES" para España) y code (CIF/NIF sin puntos, espacios ni guiones)
  - addresses: Array opcional con direcciones (street, num, locality, region, code, country)
  - emails: Array opcional con objetos {addr: "email@example.com"}
- totals: Objeto bill.Totals con:
  - sum: Suma sin impuestos (string, ej. "200.00")
  - taxes: Objeto con:
    - categories: Array con objetos {code: "VAT", rates: [...], base: "...", amount: "..."}
    - sum: Suma total de impuestos (string)
  - tax: Monto total de impuestos (string)
  - total_with_tax: Total con impuestos (string)
  - payable: Importe a pagar (string)

PROPIEDADES RECOMENDADAS (incluir si están disponibles):
- $regime: "ES" para España
- series: Serie de la factura
- code: Código/número de la factura
- lines: Array de líneas bill.Line, cada una con:
  - i: Índice (1, 2, 3...)
  - quantity: Cantidad como string (ej. "2", "1.5")
  - item: Objeto con name (requerido), price (requerido, string), code y description (opcionales)
  - discounts: Array opcional de descuentos con percent o amount (strings)
  - taxes: Array con objetos {cat: "VAT", rate: "standard", percent: "21.0%", amount: "..."}
  - sum: Suma antes de impuestos (string)
  - total: Total con impuestos (string)

PROPIEDADES OPCIONALES (incluir si están disponibles):
- issue_time: Hora de emisión (HH:MM:SS)
- customer: Objeto org.Party del cliente (puede omitirse en facturas simplificadas)
- $tags: Array de etiquetas (ej. ["simplified"])

Reglas CRÍTICAS:
- Si un campo no se puede leer, omítelo. NO inventes datos.
- El CIF/NIF es OBLIGATORIO en supplier.tax_id.code (sin puntos, espacios ni guiones).
- TODOS los importes monetarios deben ser STRINGS, no números: "100.00", "21.0%", "242.00".
- Los porcentajes también como strings: "21.0%", "10.0%", "4.0%".
- Las cantidades también como strings: "2", "1.5", "0.5".
- Para facturas simplificadas (tickets), puedes usar $tags: ["simplified"] y omitir customer.
- Si no hay líneas detalladas, crea al menos una línea con el total general.

- Devuelve SOLO el objeto JSON válido, sin texto adicional alrededor.
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
        supplierName: null,
        issueDate: null,
        currency: null,
        totalAmount: null,
        taxCode: null,
        lines: [],
      };
    }


    // Insert into Supabase
    try {
      const { error } = await supabase
        .from('expenses_invoices')
        .insert({
          profile_id: profile.id,
          source_image_url: imageUrl,
          gobl_invoice: goblInvoice,
          raw_ocr: rawResponse,
        });

      if (error) {
        logger.error('Error inserting expenses invoice', { error: error.message });
        return {
          success: false,
          message: 'He leído el ticket pero no he podido guardarlo en la base de datos.',
          invoice: goblInvoice,
          supplierName: null,
          issueDate: null,
          currency: null,
          totalAmount: null,
          taxCode: null,
          lines: [],
        };
      }
    } catch (error: any) {
      logger.error('Exception inserting expenses invoice', { error });
      return {
        success: false,
        message: 'He leído el ticket pero no he podido guardarlo en la base de datos.',
        invoice: goblInvoice,
        supplierName: null,
        issueDate: null,
        currency: null,
        totalAmount: null,
        taxCode: null,
        lines: [],
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
    // GOBL uses strings for monetary amounts, convert to number for our output
    if (typeof goblInvoice?.totals?.payable === 'string') {
      totalAmount = parseFloat(goblInvoice.totals.payable);
    } else if (typeof goblInvoice?.totals?.payable === 'number') {
      totalAmount = goblInvoice.totals.payable;
    } else if (typeof goblInvoice?.totals?.total_with_tax === 'string') {
      totalAmount = parseFloat(goblInvoice.totals.total_with_tax);
    } else if (typeof goblInvoice?.totals?.total_with_tax === 'number') {
      totalAmount = goblInvoice.totals.total_with_tax;
    } else if (typeof goblInvoice?.totals?.sum === 'string') {
      totalAmount = parseFloat(goblInvoice.totals.sum);
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
      lines: goblInvoice?.lines ?? [],
    };
  },
});

