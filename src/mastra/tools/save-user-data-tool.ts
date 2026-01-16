import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { parseMemoryRequestContext } from '@mastra/core/memory';
import { supabase } from '../supabase';

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
    dni: z.string().optional().describe('DNI/NIE for self-employed (e.g., 123456789A)'),
    nif: z.string().optional().describe('NIF for self-employed (same as DNI, used as tax code)'),
    
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
      .select('invoapp_data')
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
    const userType = inputData?.userType;

    // Update company data
    if (inputData?.companyName) {
      invoappData.name = inputData.companyName;
      savedFields.push('nombre de empresa');
    }

    // Handle tax ID: CIF for companies, NIF for self-employed
    if (userType === 'empresa' && inputData?.cif) {
      invoappData.tax_id = {
        country: "ES",
        code: inputData.cif,
      };
      savedFields.push('CIF');
    } else if (userType === 'autonomo' && (inputData?.nif || inputData?.dni)) {
      // For self-employed, use NIF (or DNI if NIF not provided)
      const taxCode = inputData.nif || inputData.dni;
      invoappData.tax_id = {
        country: "ES",
        code: taxCode,
      };
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
    if (inputData?.dni) {
      if (!person.identities) person.identities = [];
      person.identities = [{
        key: "national",
        code: inputData.dni,
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
    if (inputData?.email) {
      invoappData.emails = [{
        addr: inputData.email,
      }];
      savedFields.push('email');
    }

    // Save to Supabase
    const { error } = await supabase
      .from('profiles')
      .update({ 
        invoapp_data: invoappData,
        // Also save individual fields for easy access
        name: person.name?.given || invoappData.name,
        cif: invoappData.tax_id?.code,
        email: inputData?.email,
      })
      .eq('id', resourceId);

    if (error) {
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
