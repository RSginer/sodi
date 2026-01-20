import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Tool para obtener la fecha de "hoy" pensando siempre en la zona horaria de Madrid (Europe/Madrid),
 * pero devolviendo:
 * - la fecha local de Madrid (YYYY-MM-DD)
 * - el inicio del día en Madrid convertido a UTC (ISO)
 * - el final del día en Madrid convertido a UTC (ISO)
 *
 * Esto te permite trabajar siempre con días de España aunque el servidor esté en otra zona horaria.
 */
export const getTodayMadridDateTool = createTool({
  id: 'get-today-madrid-date',
  description: `Devuelve la fecha de HOY según la zona horaria de España (Europe/Madrid), junto con los límites del día en UTC.
Úsala cuando necesites trabajar con fechas de hoy teniendo en cuenta el horario de Madrid, por ejemplo para filtrar gastos de "hoy" en la base de datos.`,
  inputSchema: z
    .object({
      /**
       * Permite sobreescribir la "fecha base" en tests o para simular otro día.
       * Formato: ISO 8601 completo (por ejemplo, 2026-01-20T10:00:00Z).
       * Si no se pasa, se usa la fecha/hora actual.
       */
      now: z
        .string()
        .datetime()
        .optional()
        .describe(
          'Fecha/hora base en formato ISO 8601 (opcional). Si no se indica, se usa la hora actual.'
        ),
    })
    .optional(),
  outputSchema: z.object({
    /**
     * Fecha de hoy en Madrid en formato YYYY-MM-DD.
     */
    madridDate: z
      .string()
      .describe('Fecha de hoy en la zona horaria Europe/Madrid, en formato YYYY-MM-DD.'),
    /**
     * Inicio del día de hoy en Madrid, convertido a UTC (ISO).
     */
    madridStartOfDayUtc: z
      .string()
      .describe(
        'Inicio del día de hoy en Madrid (00:00:00 Europe/Madrid) convertido a UTC, en formato ISO 8601.'
      ),
    /**
     * Fin del día de hoy en Madrid, convertido a UTC (ISO).
     */
    madridEndOfDayUtc: z
      .string()
      .describe(
        'Fin del día de hoy en Madrid (23:59:59.999 Europe/Madrid) convertido a UTC, en formato ISO 8601.'
      ),
    /**
     * Información auxiliar de depuración.
     */
    info: z
      .string()
      .describe(
        'Descripción corta de cómo se ha calculado la fecha (por ejemplo, fecha base usada y zona horaria).'
      ),
  }),
  execute: async (input) => {
    const baseNow = input?.now ? new Date(input.now) : new Date();

    // Obtenemos la fecha "vista" desde Madrid usando Intl.DateTimeFormat
    const madridFormatter = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const parts = madridFormatter.formatToParts(baseNow);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    if (!year || !month || !day) {
      throw new Error('No se ha podido calcular la fecha de hoy para Europe/Madrid');
    }

    const madridDate = `${year}-${month}-${day}`; // YYYY-MM-DD

    // Construimos el inicio y fin de día en la zona horaria de Madrid y los convertimos a UTC.
    // Truco: creamos un string con zona horaria explícita Europe/Madrid y dejamos que el motor lo convierta.
    // En Node 20+ (con Temporal) esto se podría hacer más limpio, pero aquí usamos un approach compatible.

    const startOfDayMadridIso = new Date(
      new Date(`${madridDate}T00:00:00`).toLocaleString('en-US', { timeZone: 'Europe/Madrid' })
    ).toISOString();

    const endOfDayMadridIso = new Date(
      new Date(`${madridDate}T23:59:59.999`).toLocaleString('en-US', { timeZone: 'Europe/Madrid' })
    ).toISOString();

    return {
      madridDate,
      madridStartOfDayUtc: startOfDayMadridIso,
      madridEndOfDayUtc: endOfDayMadridIso,
      info: `Calculado usando baseNow=${baseNow.toISOString()} y zona horaria Europe/Madrid.`,
    };
  },
});

