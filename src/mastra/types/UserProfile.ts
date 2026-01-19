import { GoblParty } from "../invopop/invopop-client";

export interface UserProfile {
    id: string;
    phone: string;
    invopop_data: GoblParty | null;
    name: string | null;
    email: string | null;
    verifactu_completed: boolean | null;
    verifactu_status: string | null;
    verifactu_link: string | null;
}