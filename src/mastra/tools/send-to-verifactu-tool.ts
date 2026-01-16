import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({
  name: 'SendToVerifactuTool',
  level: 'info',
});

const INVOPOP_API_BASE = 'https://api.invopop.com';
const INVOPOP_API_TOKEN = process.env.INVOPOP_API_TOKEN;
const INVOPOP_WORKFLOW_ID = process.env.INVOPOP_WORKFLOW_ID;

export const sendToVerifactuTool = createTool({
  id: 'send-to-verifactu',
  description: `Registers a supplier in Invopop for VERI*FACTU invoice generation.
  This tool creates a silo entry in Invopop with the supplier's data and starts the VERI*FACTU registration workflow.
  Use this tool when you have collected all required user data (user type, name, DNI, NIF/CIF, address, email).
  The tool will validate that all required data is present before proceeding.`,
  inputSchema: z.object({
    // No input needed - uses resourceId from context
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    siloEntryId: z.string().optional().describe('ID of the created silo entry in Invopop'),
    jobId: z.string().optional().describe('ID of the created job in Invopop'),
    registrationLink: z.string().optional().describe('URL for supplier to complete registration'),
  }),
  execute: async (inputData, context) => {
    const memoryContext = parseMemoryRequestContext(context?.requestContext);
    const resourceId = memoryContext?.resourceId;

    if (!resourceId) {
      return {
        success: false,
        message: 'No se pudo identificar al usuario',
      };
    }

    if (!INVOPOP_API_TOKEN) {
      logger.error('INVOPOP_API_TOKEN not configured');
      return {
        success: false,
        message: 'Error de configuración: falta INVOPOP_API_TOKEN',
      };
    }

    if (!INVOPOP_WORKFLOW_ID) {
      logger.error('INVOPOP_WORKFLOW_ID not configured');
      return {
        success: false,
        message: 'Error de configuración: falta INVOPOP_WORKFLOW_ID',
      };
    }

    try {
      // Get user data from Supabase
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_type, name, cif, email, invoapp_data')
        .eq('id', resourceId)
        .single();

      if (profileError || !profile) {
        logger.error('Error fetching user profile', { error: profileError });
        return {
          success: false,
          message: `Error al obtener datos del usuario: ${profileError?.message || 'Usuario no encontrado'}`,
        };
      }

      const invoappData = profile.invoapp_data as any;
      const userType = profile.user_type as 'autonomo' | 'empresa' | null;

      if (!userType) {
        return {
          success: false,
          message: 'Falta el tipo de usuario. Debe ser "autonomo" o "empresa"',
        };
      }

      // Extract and validate required data
      const person = invoappData?.people?.[0];
      const firstName = person?.name?.given;
      const lastName = person?.name?.surname;
      const dni = person?.identities?.[0]?.code;
      const taxCode = invoappData?.tax_id?.code;
      const companyName = invoappData?.name;
      const companyAddress = invoappData?.addresses?.[0];
      const personalAddress = person?.addresses?.[0];
      const email = profile.email || invoappData?.emails?.[0]?.addr;

      // Validate required fields
      const missingFields: string[] = [];

      if (userType === 'empresa') {
        if (!companyName) missingFields.push('nombre de empresa');
        if (!taxCode) missingFields.push('CIF');
        if (!firstName || !lastName) missingFields.push('nombre completo del representante legal');
        if (!dni) missingFields.push('DNI del representante legal');
      } else {
        // autónomo
        if (!firstName || !lastName) missingFields.push('nombre completo');
        if (!taxCode) missingFields.push('NIF');
        if (!dni) missingFields.push('DNI');
      }

      if (!companyAddress?.street) missingFields.push('dirección fiscal');
      if (!email) missingFields.push('email');

      if (missingFields.length > 0) {
        return {
          success: false,
          message: `Faltan datos requeridos: ${missingFields.join(', ')}`,
        };
      }

      // Build GOBL party object based on user type
      let goblParty: any;

      if (userType === 'empresa') {
        // Company supplier structure
        goblParty = {
          $schema: 'https://gobl.org/draft-0/org/party',
          name: companyName,
          tax_id: {
            country: 'ES',
            code: taxCode,
          },
          addresses: [{
            num: companyAddress.num || '',
            street: companyAddress.street,
            locality: companyAddress.locality,
            region: companyAddress.region,
            code: companyAddress.code,
            country: 'ES',
          }],
          emails: [{
            addr: email,
          }],
          people: [{
            name: {
              given: firstName,
              surname: lastName,
            },
            identities: [{
              key: 'national',
              code: dni,
            }],
            addresses: personalAddress ? [{
              num: personalAddress.num || '',
              street: personalAddress.street,
              locality: personalAddress.locality,
              region: personalAddress.region,
              code: personalAddress.code,
              country: 'ES',
            }] : [],
          }],
        };
      } else {
        // Autónomo structure (no separate legal representative)
        goblParty = {
          $schema: 'https://gobl.org/draft-0/org/party',
          name: `${firstName} ${lastName}`,
          tax_id: {
            country: 'ES',
            code: taxCode,
          },
          addresses: [{
            num: companyAddress.num || '',
            street: companyAddress.street,
            locality: companyAddress.locality,
            region: companyAddress.region,
            code: companyAddress.code,
            country: 'ES',
          }],
          emails: [{
            addr: email,
          }],
        };
      }

      logger.info('Creating silo entry in Invopop', { userType, taxCode });

      // Create silo entry in Invopop
      const entryResponse = await fetch(`${INVOPOP_API_BASE}/silo/v1/entries`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${INVOPOP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: goblParty,
          folder: 'suppliers',
        }),
      });

      if (!entryResponse.ok) {
        const errorText = await entryResponse.text();
        logger.error('Error creating silo entry', {
          status: entryResponse.status,
          error: errorText
        });
        return {
          success: false,
          message: `Error al crear entrada en Invopop: ${entryResponse.status} - ${errorText}`,
        };
      }

      const entryData = await entryResponse.json();
      const siloEntryId = entryData.id;

      logger.info('Silo entry created', { siloEntryId });

      // Create job for VERI*FACTU workflow
      const jobResponse = await fetch(`${INVOPOP_API_BASE}/transform/v1/jobs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${INVOPOP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: INVOPOP_WORKFLOW_ID,
          silo_entry_id: siloEntryId,
        }),
      });

      if (!jobResponse.ok) {
        const errorText = await jobResponse.text();
        logger.error('Error creating job', {
          status: jobResponse.status,
          error: errorText
        });
        return {
          success: false,
          message: `Error al crear job en Invopop: ${jobResponse.status} - ${errorText}`,
          siloEntryId,
        };
      }

      const jobData = await jobResponse.json();
      const jobId = jobData.id;

      logger.info('Job created', { jobId, siloEntryId });

      // Fetch the entry to get the registration link from meta
      // The registration link is created by the "Register supplier" step in the workflow
      // We'll need to wait a bit or fetch it separately
      let registrationLink: string | undefined;

      try {
        // Wait a moment for the workflow to process

        const fetchEntryResponse = await fetch(`${INVOPOP_API_BASE}/silo/v1/entries/${siloEntryId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${INVOPOP_API_TOKEN}`,
          },
        });

        if (fetchEntryResponse.ok) {
          const entryDetails = await fetchEntryResponse.json();
          const meta = entryDetails.meta || [];
          const verifactuMeta = meta.find((m: any) => m.src === 'verifactu' && m.key === 'link');
          if (verifactuMeta?.link_url) {
            registrationLink = process.env.PUBLIC_URL + "/verifactu?id=" + resourceId;
          }

          const { error } = await supabase
            .from('profiles')
            .update({ verifactu_link: verifactuMeta.link_url, verifactu_status: 'processing' })
            .eq('id', resourceId)

          if (error) {
            logger.error("Error updating profile", { error: error.message, code: error.code, details: error.details });
          }
        }
      } catch (metaError) {
        logger.warn('Could not fetch registration link', { error: metaError });
        // Non-critical error, continue
      }

      return {
        success: true,
        message: `Proveedor registrado con éxito. El proceso de registro de VERI*FACTU ha comenzado.${registrationLink ? ` El usuario debe completar el registro en: ${registrationLink}` : ''}`,
        siloEntryId,
        jobId,
        registrationLink,
      };
    } catch (error) {
      logger.error('Exception in sendToVerifactuTool', { error });
      return {
        success: false,
        message: `Error inesperado: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
