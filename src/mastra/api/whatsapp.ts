import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { env } from "hono/adapter";
import twilio from "twilio";

const logger = new PinoLogger({
    name: "WhatsappWebhook",
    level: "info",
});

import { createClient } from '@supabase/supabase-js';

// IMPORTANTE: Usa la SERVICE_ROLE_KEY para poder saltarte la confirmación por SMS
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

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

        let { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, phone')
            .eq('phone', from)
            .single();

        if (!profile) {
            // 2. Si no existe, lo creamos en Supabase Auth directamente
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                phone: from,
                phone_confirm: true, // Esto es clave: marcamos como verificado sin enviar SMS
                user_metadata: { source: 'whatsapp' },

            });

            logger.info("Created user in Supabase Auth", { authUser, error: authError });

            if (authError) return c.json({ error: authError.message }, 500);

            // El trigger que configuraremos abajo creará el registro en la tabla 'profiles' automáticamente
            profile = { id: authUser.user.id, phone: from };
        }

        try {
            if (messageSid?.startsWith("SM")) {
                try {
                    await client.messaging.v2.typingIndicator.create({
                        messageId: messageSid,
                        channel: "whatsapp",
                    });
                } catch (e) {
                    logger.warn("Typing indicator failed, skipping...");
                }
            }

            const agent = c.var.mastra.getAgent("weatherAgent");
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