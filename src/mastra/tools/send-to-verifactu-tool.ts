import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';
import { InvopopClient } from '../invopop/invopop-client';

const logger = new PinoLogger({ name: 'SendToVerifactuTool', level: 'info' });

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
    missingFields: z.array(z.string()).optional().describe('Fields that are missing'),
  }),
  execute: async (inputData, context) => {
    const memoryContext = parseMemoryRequestContext(context?.requestContext);
    const resourceId = memoryContext?.resourceId;

    if (!resourceId) {
      return { success: false, message: 'No se pudo identificar al usuario' };
    }

    const invopopClient = new InvopopClient();
    const configValidation = invopopClient.validateConfig();
    if (!configValidation.success) {
      return configValidation as any;
    }

    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_type, name, cif, email, invopop_data')
        .eq('id', resourceId)
        .single();

      if (profileError || !profile) {
        logger.error('Error fetching user profile', { error: profileError });
        return { success: false, message: `Error al obtener datos del usuario: ${profileError?.message || 'Usuario no encontrado'}` };
      }

      const invopopData = profile.invopop_data as any;
      const userType = profile.user_type as 'autonomo' | 'empresa' | null;
      const person = invopopData?.people?.[0];
      const firstName = person?.name?.given;
      const lastName = person?.name?.surname;
      const dni = person?.identities?.[0]?.code;
      const taxCode = invopopData?.tax_id?.code;
      const companyName = invopopData?.name;
      const companyAddress = invopopData?.addresses?.[0];
      const personalAddress = person?.addresses?.[0];
      const email = profile.email || invopopData?.emails?.[0]?.addr;

      const missingFields: string[] = [];
      
      if (userType === 'empresa') {
        if (!companyName) missingFields.push('nombre de empresa');
        if (!taxCode) missingFields.push('CIF');
        if (!firstName || !lastName) missingFields.push('nombre completo del representante legal');
        if (!dni) missingFields.push('DNI del representante legal');
      } else {
        if (!firstName || !lastName) missingFields.push('nombre completo');
        if (!taxCode) missingFields.push('NIF');
        if (!dni) missingFields.push('DNI');
      }
      
      if (!companyAddress?.street) missingFields.push('dirección fiscal');
      if (!email) missingFields.push('email');

      if (!userType) {
        missingFields.push('tipo de usuario');
      }

      if (missingFields.length > 0) {
        return { success: false, message: `Faltan datos requeridos: ${missingFields.join(', ')}` };
      }

      const goblParty = InvopopClient.buildGoblParty(
        userType as 'autonomo' | 'empresa',
        companyName,
        firstName,
        lastName,
        dni,
        taxCode,
        email,
        companyAddress,
        personalAddress
      );

      logger.info('Creating silo entry in Invopop', { userType, taxCode });

      const siloEntryId = await invopopClient.createSiloEntry(goblParty);
      logger.info('Silo entry created', { siloEntryId });

      const jobId = await invopopClient.createWorkflowJob(siloEntryId);
      logger.info('Job created', { jobId, siloEntryId });

      let registrationLink: string | undefined;
      const verifactuLink = await invopopClient.getRegistrationLink(siloEntryId, resourceId);

      if (verifactuLink) {
        registrationLink = `${process.env.PUBLIC_URL}/verifactu?id=${resourceId}`;
        await supabase
          .from('profiles')
          .update({ verifactu_link: verifactuLink, verifactu_status: 'processing' })
          .eq('id', resourceId);
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

