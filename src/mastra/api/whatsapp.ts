import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { env } from "hono/adapter";
import UserService from "../services/user-service";
import { RequestContext } from "@mastra/core/request-context";
import {
    MessagingResponse,
    twilio,
    validateRequest
} from "../twilio";

import { Context } from "hono";

const logger = new PinoLogger({
    name: "WhatsappWebhook",
    level: "info",
});


const parseFormData = async (c: Context): Promise<Record<string, string>> => {
    const formData = await c.req.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
        params[key] = value.toString();
    });
    return params;
}

export const whatsappWebhook = registerApiRoute("/whatsapp/webhook", {
    method: "POST",
    handler: async (c: Context) => {
        const authToken = env<{ TWILIO_AUTH_TOKEN: string }>(c).TWILIO_AUTH_TOKEN;
        const params = await parseFormData(c);
        const twilioSignature = c.req.header("X-Twilio-Signature");
        const url = new URL(c.req.url);
        url.protocol = "https";

        if (!validateRequest(authToken!, twilioSignature!, url.toString(), params as Record<string, any>)) {
            const response = new MessagingResponse();
            response.message("No tienes permisos para acceder a este servicio.");
            c.header("Content-Type", "text/xml");
            return c.body(response.toString(), 200);
        }

        void handleMessage(c, params);

        return c.body(null, 200);
    },
});


const handleMessage = async (c: Context, params: Record<string, string>) => {
    const threadId = params["WaId"];

    try {
        let profile = await UserService.getUserProfileByPhone(threadId);

        if (!profile) {
            profile = await UserService.createUserProfile(threadId, JSON.parse(params["ChannelMetadata"] || "{}"));
        }

        try {
            await twilio.messaging.v2.typingIndicator.create({
                channel: "whatsapp",
                messageId: params["MessageSid"],
            })
        } catch (error) {
            logger.warn("Error creating typing indicator", { error });
        }

        const requestContext = new RequestContext();
        requestContext.set('profile', profile);

        const isVerifactuProcessing = profile.verifactu_status === 'processing';
        const isVerifactuRegistered = profile.verifactu_status === 'registered';

        if (isVerifactuProcessing) {
            return await twilio.messages.create({
                from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
                to: `whatsapp:+${threadId}`,
                body: "Tienes pendiente el proceso de registro de VERI*FACTU. Por favor, entra en el siguiente enlace y sigue los pasos para completar el registro. " + profile.verifactu_link || "",
            });
        }

        if (isVerifactuRegistered) {
            return await twilio.messages.create({
                from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
                to: `whatsapp:+${threadId}`,
                body: "Ya hemos recibido tus datos para el registro de VERI*FACTU. Ahora están siendo verificados. Recibirás una notificación cuando el proceso esté completado.",
            });
        }

        const agent = c.var.mastra.getAgent("onboardingAgent");

        const result = await agent.generate(params["Body"] || "", {
            requestContext: requestContext,
            memory: {
                thread: threadId,
                resource: profile.id
            }
        });

        const aiResponse = result.text;

        return await twilio.messages.create({
            from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
            to: `whatsapp:+${threadId}`,
            body: aiResponse,
        });


    } catch (error) {
        logger.error("Error processing message", { error: error instanceof Error ? error.message : "Unknown error" });

        return await twilio.messages.create({
            from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
            to: `whatsapp:+${threadId}`,
            body: "Lo siento, tuve un error técnico. Intenta más tarde.",
        });
    }
}