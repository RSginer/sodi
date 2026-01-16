import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({
  name: 'GetUserDataTool',
  level: 'info',
});

export const getUserDataTool = createTool({
  id: 'get-user-data',
  description: `Retrieves the current user's registration data from the system.
  Use this tool to check what information has already been collected and what is still missing.
  This helps you avoid asking for information the user has already provided.`,
  inputSchema: z.object({
    // No input needed - uses resourceId from context
  }),
  outputSchema: z.object({
    success: z.boolean(),
    userType: z.enum(['autonomo', 'empresa']).nullable().optional().describe('User type: autonomo (self-employed) or empresa (company)'),
    hasData: z.boolean().describe('Whether any user data exists'),
    data: z.object({
      // Basic info
      name: z.string().nullable().optional().describe('Full name (first name + last name) or company name'),
      firstName: z.string().nullable().optional().describe('First name'),
      lastName: z.string().nullable().optional().describe('Last name'),
      dni: z.string().nullable().optional().describe('DNI/NIE'),
      nif: z.string().nullable().optional().describe('NIF (for self-employed)'),
      cif: z.string().nullable().optional().describe('CIF (for companies)'),
      companyName: z.string().nullable().optional().describe('Company name'),
      email: z.string().nullable().optional().describe('Email address'),
      
      // Addresses
      companyAddress: z.object({
        street: z.string().nullable().optional(),
        number: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        province: z.string().nullable().optional(),
        postalCode: z.string().nullable().optional(),
      }).nullable().optional().describe('Company/fiscal address'),
      personalAddress: z.object({
        street: z.string().nullable().optional(),
        number: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        province: z.string().nullable().optional(),
        postalCode: z.string().nullable().optional(),
      }).nullable().optional().describe('Personal address'),
      
      // Completion status
      missingFields: z.array(z.string()).optional().describe('List of missing required fields'),
    }).optional(),
    message: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const memoryContext = parseMemoryRequestContext(context?.requestContext);
    const resourceId = memoryContext?.resourceId;
    
    if (!resourceId) {
      return {
        success: false,
        hasData: false,
        message: 'No se pudo identificar al usuario',
      };
    }

    try {
      // Get user data from Supabase
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('user_type, name, cif, email, invoapp_data')
        .eq('id', resourceId)
        .single();

      if (error) {
        logger.error("Error fetching user data", { error });
        return {
          success: false,
          hasData: false,
          message: `Error al obtener datos: ${error.message}`,
        };
      }

      if (!profile) {
        return {
          success: true,
          hasData: false,
          userType: null,
          message: 'Usuario no encontrado',
        };
      }

      const invoappData = profile.invoapp_data as any;
      const userType = profile.user_type as 'autonomo' | 'empresa' | null;

      // Extract person data
      const person = invoappData?.people?.[0];
      const firstName = person?.name?.given || null;
      const lastName = person?.name?.surname || null;
      const dni = person?.identities?.[0]?.code || null;
      
      // Extract tax codes
      const taxCode = invoappData?.tax_id?.code || profile.cif || null;
      const nif = userType === 'autonomo' ? taxCode : null;
      const cif = userType === 'empresa' ? taxCode : null;
      
      // Extract company name
      const companyName = invoappData?.name || null;
      
      // Extract addresses
      const companyAddressData = invoappData?.addresses?.[0];
      const companyAddress = companyAddressData ? {
        street: companyAddressData.street || null,
        number: companyAddressData.num || null,
        city: companyAddressData.locality || null,
        province: companyAddressData.region || null,
        postalCode: companyAddressData.code || null,
      } : null;

      const personalAddressData = person?.addresses?.[0];
      const personalAddress = personalAddressData ? {
        street: personalAddressData.street || null,
        number: personalAddressData.num || null,
        city: personalAddressData.locality || null,
        province: personalAddressData.region || null,
        postalCode: personalAddressData.code || null,
      } : null;

      // Extract email
      const email = profile.email || invoappData?.emails?.[0]?.addr || null;

      // Build full name
      const fullName = profile.name || (firstName && lastName ? `${firstName} ${lastName}` : firstName || companyName) || null;

      // Determine missing fields
      const missingFields: string[] = [];
      if (!userType) missingFields.push('tipo de usuario');
      if (!firstName && !companyName) missingFields.push('nombre');
      if (!lastName && userType === 'autonomo') missingFields.push('apellidos');
      if (!dni) missingFields.push('DNI/NIE');
      if (!taxCode) missingFields.push('NIF/CIF');
      if (!companyAddress?.street) missingFields.push('dirección fiscal');
      if (!email) missingFields.push('email');

      const hasData = !!(firstName || companyName || dni || taxCode || companyAddress || email);

      return {
        success: true,
        hasData,
        userType: userType || null,
        data: {
          name: fullName,
          firstName,
          lastName,
          dni,
          nif,
          cif,
          companyName,
          email,
          companyAddress,
          personalAddress,
          missingFields: missingFields.length > 0 ? missingFields : undefined,
        },
        message: hasData 
          ? `Datos encontrados. Faltan: ${missingFields.length > 0 ? missingFields.join(', ') : 'ninguno'}`
          : 'No hay datos guardados aún',
      };
    } catch (error) {
      logger.error("Exception fetching user data", { error });
      return {
        success: false,
        hasData: false,
        message: `Error inesperado: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
