import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { env } from "hono/adapter";
import twilio from "twilio";
import { supabase } from "../supabase";

const logger = new PinoLogger({
    name: "WhatsappWebhook",
    level: "info",
});



const MessagingResponse = twilio.twiml.MessagingResponse;

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
        const messageSid = params["MessageSid"] || params["SmsMessageSid"] || params["SmsSid"] || "";
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
            .select('id, phone, invopop_data, name, email, verifactu_completed, verifactu_status, verifactu_link')
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

            profile = { id: authUser.user.id, phone: from, invopop_data: null, name: null, email: null, verifactu_completed: false, verifactu_status: null, verifactu_link: null };
        }

        const invopopData = profile.invopop_data as any;
        const hasName = profile.name || (invopopData?.people?.[0]?.name?.given);
        const hasDNI = invopopData?.people?.[0]?.identities?.[0]?.code;
        const hasTaxCode = invopopData?.tax_id?.code; // NIF for autonomo, CIF for empresa
        const hasAddress = invopopData?.addresses?.[0]?.street;
        const hasEmail = profile.email || invopopData?.emails?.[0]?.addr;
        const hasVerifactuCompleted = profile.verifactu_completed;
        const isVerifactuPending = profile.verifactu_status === 'processing';

        const isUserRegistered = hasName && hasDNI && hasTaxCode && hasAddress && hasEmail && hasVerifactuCompleted;

        try {
            // Send typing indicator via Twilio Messaging API using the actual messageSid
            try {
                const response = await fetch("https://messaging.twilio.com/v2/Indicators/Typing.json", {
                    method: "POST",
                    headers: {
                        "Authorization":
                            "Basic " +
                            Buffer.from(
                                `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
                            ).toString("base64"),
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: new URLSearchParams({
                        messageId: messageSid,
                        channel: "whatsapp"
                    }).toString()
                });
                if (!response.ok) {
                    logger.warn("Typing indicator failed, skipping...", { error: response.statusText });
                }

                logger.info("Typing indicator sent", { response: await response.json() });
            } catch (e) {
                logger.warn("Typing indicator failed, skipping...", { error: JSON.stringify(e) });
            }

            if (isVerifactuPending) {
                const response = new MessagingResponse();
                response.message("Tienes pendiente el proceso de registro de VERI*FACTU. Por favor, entra en el siguiente enlace y sigue los pasos para completar el registro.");
                response.message(process.env.PUBLIC_URL + "/verifactu?id=" + profile.id);
                return c.body(response.toString(), 200, {
                    "Content-Type": "text/xml",
                });
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

     
            const response = new MessagingResponse();
            response.message(aiResponse);
            return c.body(response.toString(), 200, {
                "Content-Type": "text/xml",
            });


        } catch (error) {
            logger.error("Error processing message", { error });

            const MessagingResponse = twilio.twiml.MessagingResponse;
            const response = new MessagingResponse();
            response.message("Lo siento, tuve un error técnico. Intenta más tarde.");
            return c.body(response.toString(), 200, {
                "Content-Type": "text/xml",
            });
        }
    },
});