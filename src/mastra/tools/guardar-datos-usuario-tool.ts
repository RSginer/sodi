import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({
    name: 'SaveUserDataTool',
    level: 'info',
  })
  
export const saveUserDataTool = createTool({
  id: 'save-user-data',
  description: `Saves user data in invoapp format for system registration.
  Data is saved in JSON format compatible with invoapp (gobl.org schema).
  You can save partial data - it will be completed gradually.`,
  inputSchema: z.object({
    // User type
    userType: z.enum(['autonomo', 'empresa']).optional().describe('User type: autonomo (self-employed) or empresa (company)'),
    
    // Company data
    companyName: z.string().optional().describe('Company name or business name'),
    cif: z.string().optional().describe('CIF for companies (e.g., B85905495)'),
    
    // Person data
    firstName: z.string().optional().describe('Person first name'),
    lastName: z.string().optional().describe('Person last name'),
    nif: z.string().optional().describe('NIF for self-employed (e.g., 123456789A)'),
    
    // Company address
    companyAddressNumber: z.string().optional().describe('Company address number'),
    companyAddressStreet: z.string().optional().describe('Company address street'),
    companyAddressCity: z.string().optional().describe('Company address city'),
    companyAddressProvince: z.string().optional().describe('Company address province'),
    companyAddressPostalCode: z.string().optional().describe('Company address postal code'),
    
    // Personal address
    personalAddressNumber: z.string().optional().describe('Personal address number'),
    personalAddressStreet: z.string().optional().describe('Personal address street'),
    personalAddressCity: z.string().optional().describe('Personal address city'),
    personalAddressProvince: z.string().optional().describe('Personal address province'),
    personalAddressPostalCode: z.string().optional().describe('Personal address postal code'),
    
    // Email
    email: z.string().email().optional().describe('Contact/billing email'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    savedFields: z.array(z.string()).optional(),
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

    // Get existing data
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_type, invoapp_data')
      .eq('id', resourceId)
      .single();

    // Build invoapp object from existing data or create new one
    let invoappData: any = profile?.invoapp_data || {
      $schema: "https://gobl.org/draft-0/org/party",
      tax_id: { country: "ES" },
      people: [{}],
      addresses: [],
      emails: [],
    };

    const savedFields: string[] = [];
    const userType = profile?.user_type || inputData?.userType;

    // Update company data
    if (inputData?.companyName) {
      invoappData.name = inputData.companyName;
      savedFields.push('nombre de empresa');
    }

    // Handle tax ID: CIF for companies, NIF for self-employed
    // Ensure tax_id exists and preserve country if already set
    if (!invoappData.tax_id) {
      invoappData.tax_id = { country: "ES" };
    }
    if (!invoappData.tax_id.country) {
      invoappData.tax_id.country = "ES";
    }

    if (userType === 'empresa' && inputData?.cif) {
      invoappData.tax_id.code = inputData.cif;
      savedFields.push('CIF');
    } else if (userType === 'autonomo' && inputData?.nif) {
      invoappData.tax_id.code = inputData.nif;
      savedFields.push('NIF');
    }

    // Update person data
    if (!invoappData.people || invoappData.people.length === 0) {
      invoappData.people = [{}];
    }
    const person = invoappData.people[0];

    if (inputData?.firstName) {
      if (!person.name) person.name = {};
      person.name.given = inputData.firstName;
      savedFields.push('nombre');
    }
    if (inputData?.lastName) {
      if (!person.name) person.name = {};
      person.name.surname = inputData.lastName;
      savedFields.push('apellidos');
    }
    if (inputData?.nif) {
      if (!person.identities) person.identities = [];
      person.identities = [{
        key: "national",
        code: inputData.nif,
      }];
      savedFields.push('DNI');
    }

    // Update company address
    if (inputData?.companyAddressStreet) {
      if (!invoappData.addresses || invoappData.addresses.length === 0) {
        invoappData.addresses = [{}];
      }
      const companyAddress = invoappData.addresses[0];
      if (inputData.companyAddressNumber) companyAddress.num = inputData.companyAddressNumber;
      if (inputData.companyAddressStreet) companyAddress.street = inputData.companyAddressStreet;
      if (inputData.companyAddressCity) companyAddress.locality = inputData.companyAddressCity;
      if (inputData.companyAddressProvince) companyAddress.region = inputData.companyAddressProvince;
      if (inputData.companyAddressPostalCode) companyAddress.code = inputData.companyAddressPostalCode;
      companyAddress.country = "ES";
      savedFields.push('dirección de empresa');
    }

    // Update personal address
    if (inputData?.personalAddressStreet) {
      if (!person.addresses) person.addresses = [];
      if (person.addresses.length === 0) person.addresses = [{}];
      const personalAddress = person.addresses[0];
      if (inputData.personalAddressNumber) personalAddress.num = inputData.personalAddressNumber;
      if (inputData.personalAddressStreet) personalAddress.street = inputData.personalAddressStreet;
      if (inputData.personalAddressCity) personalAddress.locality = inputData.personalAddressCity;
      if (inputData.personalAddressProvince) personalAddress.region = inputData.personalAddressProvince;
      if (inputData.personalAddressPostalCode) personalAddress.code = inputData.personalAddressPostalCode;
      savedFields.push('dirección personal');
    }

    // Update email
    let emailToSave: string | undefined;
    if (inputData?.email) {
      invoappData.emails = [{
        addr: inputData.email,
      }];
      emailToSave = inputData.email;
      
      // Update email in Auth (non-blocking, log errors but don't fail)
      try {
        const { error: authError } = await supabase.auth.admin.updateUserById(resourceId, {
          email: inputData.email,
        });
        if (authError) {
          logger.warn("Failed to update email in Auth", { error: authError.message });
        }
      } catch (authErr) {
        logger.warn("Exception updating email in Auth", { error: authErr });
      }
      
      savedFields.push('email');
    }

    // Save to Supabase
    const updateData: any = {
      invoapp_data: invoappData,
      // Also save individual fields for easy access
      user_type: userType,
      name: person.name?.given || invoappData.name,
    };
    
    // Save tax code (CIF or NIF) in cif field for easy access
    if (invoappData.tax_id?.code) {
      updateData.cif = invoappData.tax_id.code;
    }
    
    // Save email if provided
    if (emailToSave) {
      updateData.email = emailToSave;
    }
    
    const { error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', resourceId);

    if (error) {
      logger.error("Error saving user data", { error });
      return {
        success: false,
        message: `Error al guardar: ${error.message}`,
      };
    }

    return {
      success: true,
      message: `✅ Datos guardados: ${savedFields.join(', ')}`,
      savedFields,
    };
  },
});
