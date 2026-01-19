import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({ name: 'InvopopClient', level: 'info' });

const INVOPOP_API_BASE = 'https://api.invopop.com';
const INVOPOP_API_TOKEN = process.env.INVOPOP_API_TOKEN;
const INVOPOP_WORKFLOW_ID = process.env.INVOPOP_WORKFLOW_ID;

export interface InvopopConfig {
  apiBase?: string;
  apiToken?: string;
  workflowId?: string;
}

export interface GoblAddress {
  num: string;
  street: string;
  locality: string;
  region: string;
  code: string;
  country: string;
}

export interface GoblParty {
  $schema: string;
  name: string;
  tax_id: {
    country: string;
    code: string;
  };
  addresses: GoblAddress[];
  emails: { addr: string }[];
  people?: {
    name: {
      given: string;
      surname: string;
    };
    identities: {
      key: string;
      code: string;
    }[];
    addresses: GoblAddress[];
  }[];
}

export class InvopopClient {
  private apiBase: string;
  private apiToken: string;
  private workflowId: string;

  constructor(config: InvopopConfig = {}) {
    this.apiBase = config.apiBase || INVOPOP_API_BASE;
    this.apiToken = config.apiToken || INVOPOP_API_TOKEN || '';
    this.workflowId = config.workflowId || INVOPOP_WORKFLOW_ID || '';
  }

  async createSiloEntry(goblParty: any): Promise<string> {
    const response = await fetch(`${this.apiBase}/silo/v1/entries`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: goblParty,
        folder: 'suppliers',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Error creating silo entry', {
        status: response.status,
        error: errorText
      });
      throw new Error(`Error al crear entrada en Invopop: ${response.status} - ${errorText}`);
    }

    const entryData = await response.json();
    return entryData.id;
  }

  async createWorkflowJob(siloEntryId: string): Promise<string> {
    const response = await fetch(`${this.apiBase}/transform/v1/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: this.workflowId,
        silo_entry_id: siloEntryId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Error creating job', {
        status: response.status,
        error: errorText
      });
      throw new Error(`Error al crear job en Invopop: ${response.status} - ${errorText}`);
    }

    const jobData = await response.json();
    return jobData.id;
  }

  async getRegistrationLink(siloEntryId: string): Promise<string | undefined> {
    try {
      const response = await fetch(`${this.apiBase}/silo/v1/entries/${siloEntryId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (response.ok) {
        const entryDetails = await response.json();
        const verifactuMeta = (entryDetails.meta || []).find((m: any) => m.src === 'verifactu' && m.key === 'link');
        
        if (verifactuMeta?.link_url) {
          return verifactuMeta.link_url;
        }
      }
    } catch (error) {
      logger.warn('Could not fetch registration link', { error });
    }
    return undefined;
  }

  async getSiloEntryById(siloEntryId: string): Promise<SupplierEntry | null> {
    try {
      const response = await fetch(`${this.apiBase}/silo/v1/entries/${siloEntryId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (response.ok) {
        const entryDetails = await response.json();

        return entryDetails;
      }
    } catch (error) {
      logger.warn('Could not fetch silo entry by id', { error });
    }
    return null;
  }

  // Helper to build GOBL address
  static buildGoblAddress(addr: any): GoblAddress {
    return {
      num: addr.num || '',
      street: addr.street,
      locality: addr.locality,
      region: addr.region,
      code: addr.code,
      country: 'ES',
    };
  }

  // Helper to build GOBL party
  static buildGoblParty(
    userType: 'autonomo' | 'empresa',
    companyName: string | undefined,
    firstName: string | undefined,
    lastName: string | undefined,
    dni: string | undefined,
    taxCode: string,
    email: string,
    companyAddress: any,
    personalAddress: any,
    meta: {
      user: string;
      phone: string;
    }
  ) {
    const addresses = [InvopopClient.buildGoblAddress(companyAddress)];
    const emails = [{ addr: email }];
    
    if (userType === 'empresa') {
      return {
        $schema: 'https://gobl.org/draft-0/org/party',
        name: companyName,
        tax_id: { country: 'ES', code: taxCode },
        addresses,
        emails,
        people: [{
          name: { given: firstName, surname: lastName },
          identities: [{ key: 'national', code: dni }],
          addresses: personalAddress ? [InvopopClient.buildGoblAddress(personalAddress)] : [],
        }],
        meta
      };
    } else {
      return {
        $schema: 'https://gobl.org/draft-0/org/party',
        name: `${firstName} ${lastName}`,
        tax_id: { country: 'ES', code: taxCode },
        addresses,
        emails,
        meta
      };
    }
  }

}

export interface SupplierEntry {
  id: string;
  created_at: string;
  updated_at: string;
  folder: string;
  state: string;
  draft: boolean;
  env_schema: string;
  doc_schema: string;
  digest: Digest;
  snippet: Snippet;
  attachments: Attachment[];
  data: EnvelopeData;
  meta: MetaEntry[];
}

export interface Digest {
  alg: string;
  val: string;
}

export interface Snippet {
  uuid: string;
  name: string;
  country: string;
  tax_code: string;
}

export interface Attachment {
  id: string;
  entry_id: string;
  created_at: string;
  name: string;
  hash: string;
  mime: string;
  size: number;
  stored: boolean;
  embeddable: boolean;
  private: boolean;
  meta: Record<string, string>;
}

export interface EnvelopeData {
  $schema: string;
  head: EnvelopeHead;
  doc: PartyDocument;
}

export interface EnvelopeHead {
  uuid: string;
  dig: Digest;
}

export interface PartyDocument {
  $schema: string;
  uuid: string;
  name: string;
  tax_id: TaxId;
  addresses: Address[];
  emails: Email[];
  meta: Record<string, string>;
}

export interface TaxId {
  country: string;
  code: string;
}

export interface Address {
  num: string;
  street: string;
  locality: string;
  region: string;
  code: string;
  country: string;
}

export interface Email {
  addr: string;
}

export interface MetaEntry {
  id: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
  entry_id: string;
  src: string;
  key: string;
  ref: string;
  link_url?: string;
  link_scope?: string;
  indexed?: boolean;
  shared?: boolean;
}