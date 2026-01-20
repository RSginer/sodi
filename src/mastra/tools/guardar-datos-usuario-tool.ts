import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../supabase';
import { PinoLogger } from '@mastra/loggers';
import { UserProfile } from '../types/UserProfile';
import { InvopopClient } from '../invopop/invopop-client';

const logger = new PinoLogger({
  name: 'SaveUserDataTool',
  level: 'info',
})

export const saveUserDataTool = createTool({
  id: 'save-user-data',
  description: `Saves user data in invopop format for system registration.
  Data is saved in JSON format compatible with invopop (gobl.org schema).
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
    nif: z.string().optional().describe('NIF for self-employed or in case of company, the NIF of the legal representative (e.g., 123456789A)'),

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
    const profile = context?.requestContext?.get('profile') as UserProfile;

    if (!profile) {
      return {
        success: true,
        hasData: false,
        userType: null,
        message: 'Usuario no encontrado',
      };
    }

    let invopopData: any = profile?.invopop_data || {
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
      invopopData.name = inputData.companyName;
      savedFields.push('nombre de empresa');
    }

    // Handle tax ID: CIF for companies, NIF for self-employed
    // Ensure tax_id exists and preserve country if already set
    if (!invopopData.tax_id) {
      invopopData.tax_id = { country: "ES" };
    }
    if (!invopopData.tax_id.country) {
      invopopData.tax_id.country = "ES";
    }

    if (userType === 'empresa' && inputData?.cif) {
      invopopData.tax_id.code = inputData.cif;
      savedFields.push('CIF');
    } else if (userType === 'autonomo' && inputData?.nif) {
      invopopData.tax_id.code = inputData.nif;
      savedFields.push('NIF');
    }

    if (!invopopData.people || invopopData.people.length === 0) {
      invopopData.people = [{}];
    }

    const person = invopopData.people[0];

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

    logger.info("inputData", { inputData });
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
      if (!invopopData.addresses || invopopData.addresses.length === 0) {
        invopopData.addresses = [{}];
      }
      const companyAddress = invopopData.addresses[0];
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
      const emailValue = inputData.email.trim();
      logger.info("Saving email", { email: emailValue });

      invopopData.emails = [{
        addr: emailValue,
      }];
      emailToSave = emailValue;

      // Update email in Auth (non-blocking, log errors but don't fail)
      try {
        const { error: authError } = await supabase.auth.admin.updateUserById(profile.id, {
          email: emailValue,
        });
        if (authError) {
          logger.warn("Failed to update email in Auth", { error: authError.message, email: emailValue });
        } else {
          logger.info("Email updated in Auth successfully", { email: emailValue });
        }
      } catch (authErr) {
        logger.warn("Exception updating email in Auth", { error: authErr, email: emailValue });
      }

      savedFields.push('email');
    }

    // Save to Supabase
    const updateData: any = {
      invopop_data: invopopData,
      // Also save individual fields for easy access
      user_type: userType,
      name: `${person.name?.given} ${person.name?.surname}`,
    };

    // Save email if provided
    if (emailToSave) {
      updateData.email = emailToSave;
      logger.info("Including email in update", { email: emailToSave });
    }

    logger.info("Updating profile", { profileId: profile.id, updateData: { ...updateData, invopop_data: '[...]' } });

    const { error, data: updatedProfile } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', profile.id)
      .select('*')
      .single();

    if (error) {
      logger.error("Error saving user data", { error: error.message, code: error.code, details: error.details });
      return {
        success: false,
        message: `Error al guardar: ${error.message}`,
      };
    }

    context?.requestContext?.set('profile', updatedProfile);
    
    // Update Invopop silo entry if it exists
    if (updatedProfile.invopop_silo_entry_id) {
      try {
        logger.info("Updating Invopop silo entry", { siloEntryId: updatedProfile.invopop_silo_entry_id });

        const invopopClient = new InvopopClient();
        await invopopClient.updateSiloEntry(updatedProfile.invopop_silo_entry_id, invopopData);
        logger.info("Invopop silo entry updated successfully");
      } catch (error) {
        logger.error("Error updating Invopop silo entry", { error });
        // Don't fail the whole operation if Invopop update fails
      }
    }
    
    logger.info("Profile updated successfully", {
      savedEmail: updatedProfile?.email,
      invopopEmail: (updatedProfile?.invopop_data as any)?.emails?.[0]?.addr
    });

    return {
      success: true,
      message: `✅ Datos guardados: ${savedFields.join(', ')}`,
      savedFields,
    };
  },
});
