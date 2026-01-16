import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { env } from "hono/adapter";
import twilio from "twilio";
import { supabase } from "../supabase";

const logger = new PinoLogger({
    name: "WhatsappWebhook",
    level: "info",
});


type UserTier = {
    "user-tier": "enterprise" | "pro";
};


export const whatsappWebhook = registerApiRoute("/whatsapp/webhook", {
    method: "POST",
    handler: async (c) => {
        const accountSid = env<{ TWILIO_ACCOUNT_SID: string }>(c).TWILIO_ACCOUNT_SID;
        const authToken = env<{ TWILIO_AUTH_TOKEN: string }>(c).TWILIO_AUTH_TOKEN;

        const client = twilio(accountSid, authToken, {
            logLevel: "debug",
        });
        const formData = await c.req.formData();

        const params: Record<string, string> = {};

        formData.forEach((value, key) => {
            params[key] = value.toString();
        });

        const twilioSignature = c.req.header("X-Twilio-Signature");

        if (twilioSignature && authToken) {
            const urlObj = new URL(c.req.url);
            urlObj.protocol = "https:";
            const publicUrl = urlObj.toString();
            logger.info("Validating Twilio signature", { publicUrl, params });
            const isValid = twilio.validateRequest(authToken, twilioSignature, publicUrl, params as Record<string, any>);

            logger.info("Valid Twilio signature", { isValid });

            if (!isValid) {
                const MessagingResponse = twilio.twiml.MessagingResponse;
                const response = new MessagingResponse();
                response.message("No tienes permisos para acceder a este servicio.");
                c.header("Content-Type", "text/xml");
                return c.body(response.toString(), 200);
            }

        }

        const messageBody = params["Body"] || "";
        const messageSid = params["MessageSid"] || "";
        const channelMetadata = JSON.parse(params.ChannelMetadata) as {
            type: string;
            data: {
                context: {
                    ProfileName: string;
                    WaId: string;
                };
            };
        };
        const from = `+${params["WaId"]}`;
        const threadId = params["WaId"];

        let { data: profile } = await supabase
            .from('profiles')
            .select('id, phone, invoapp_data, name')
            .eq('phone', params["WaId"])
            .single();

        if (!profile) {
            const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
                phone: from,
                phone_confirm: true,
                user_metadata: { source: 'whatsapp', channelMetadata: channelMetadata },
            });

            logger.info("Created user in Supabase Auth", { authUser, error: authError });

            if (authError) return c.json({ error: authError.message }, 500);

            profile = { id: authUser.user.id, phone: from, invoapp_data: null, name: null };
        }

        const invoappData = profile.invoapp_data as any;
        const hasName = profile.name || (invoappData?.people?.[0]?.name?.given);
        const hasDNI = invoappData?.people?.[0]?.identities?.[0]?.code;
        const hasTaxCode = invoappData?.tax_id?.code; // NIF for autonomo, CIF for empresa
        const hasAddress = invoappData?.addresses?.[0]?.street;
        
        const isUserRegistered = hasName && hasDNI && hasTaxCode && hasAddress;

        try {
            if (messageSid?.startsWith("SM")) {
                try {
                    await client.messaging.v2.typingIndicator.create({
                        messageId: messageSid,
                        channel: "whatsapp",
                    });
                } catch (e) {
                    logger.warn("Typing indicator failed, skipping...", { error: e });
                }
            }

            const agentName = isUserRegistered ? 'weatherAgent' : 'onboardingAgent';
            const agent = c.var.mastra.getAgent(agentName);
            
            logger.info("Using agent", { 
                agentName, 
                isUserRegistered,
                hasName,
                hasDNI,
                hasTaxCode,
                hasAddress
            });

            const result = await agent.generate(messageBody, {
                threadId: threadId,
                resourceId: profile.id
            });

            const aiResponse = result.text;

            const MessagingResponse = twilio.twiml.MessagingResponse;
            const response = new MessagingResponse();
            response.message(aiResponse);
            c.header("Content-Type", "text/xml");
            return c.body(response.toString(), 200);


        } catch (error) {
            logger.error("Error processing message", { error });

            const MessagingResponse = twilio.twiml.MessagingResponse;
            const response = new MessagingResponse();
            response.message("Lo siento, tuve un error técnico. Intenta más tarde.");
            c.header("Content-Type", "text/xml");
            return c.body(response.toString(), 200);
        }
    },
});