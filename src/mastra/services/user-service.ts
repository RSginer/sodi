import { supabase } from "../supabase";
import { UserProfile } from "../types/UserProfile";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger({
    name: "UserService",
    level: "info",
});

const getUserProfileByPhone = async (phone: string): Promise<UserProfile | null> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();

    if (error) {
        logger.error("Error getting user profile by phone", { error: error.message });
        throw error;
    }

    return data;
}

const createUserProfile = async (phone: string, channelMetadata: any): Promise<UserProfile> => {
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        phone: phone,
        phone_confirm: true,
        user_metadata: { source: 'whatsapp', channelMetadata: channelMetadata },
    });

    if (authError) {
        logger.error("Error creating user profile", { error: authError.message });
        throw authError;
    }

    return {
        id: authUser.user.id,
        phone: phone,
        invopop_data: null,
        user_type: null,
        name: null,
        email: null,
        verifactu_completed: false,
        verifactu_status: null,
        verifactu_link: null,
        invopop_silo_entry_id: null
    };

}

export default {
    getUserProfileByPhone,
    createUserProfile,
}