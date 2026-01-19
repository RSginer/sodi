import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { env } from "hono/adapter";
import UserService from "../services/user-service";
import {
    MessagingResponse,
    twilio,
    validateRequest
} from "../twilio";

import { GoblParty } from "../invopop/invopop-client";
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



        handleMessage(c, params);

        return c.status(200);
    },
});


const handleMessage = async (c: Context, params: Record<string, string>) => {
    try {
        try {
            await twilio.messaging.v2.typingIndicator.create({
                channel: "whatsapp",
                messageId: params["MessageSid"],
            })
        } catch (error) {
            logger.warn("Error creating typing indicator", { error });
        }

        const threadId = params["WaId"];

        let profile = await UserService.getUserProfileByPhone(threadId);

        if (!profile) {
            profile = await UserService.createUserProfile(threadId, JSON.parse(params["ChannelMetadata"] || "{}"));
        }

        logger.info("Profile found", { profile });

        const invopopData = profile.invopop_data as GoblParty;
        const hasName = profile.name || (invopopData?.people?.[0]?.name?.given);
        const hasDNI = invopopData?.people?.[0]?.identities?.[0]?.code;
        const hasTaxCode = invopopData?.tax_id?.code;
        const hasAddress = invopopData?.addresses?.[0]?.street;
        const hasEmail = profile.email || invopopData?.emails?.[0]?.addr;
        const hasVerifactuCompleted = profile.verifactu_completed;
        const isVerifactuPending = profile.verifactu_status === 'processing';

        const isUserRegistered = hasName && hasDNI && hasTaxCode && hasAddress && hasEmail && hasVerifactuCompleted;

        if (isVerifactuPending) {
            return await twilio.messages.create({
                from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
                to: `whatsapp:+${threadId}`,
                body: "Tienes pendiente el proceso de registro de VERI*FACTU. Por favor, entra en el siguiente enlace y sigue los pasos para completar el registro.",
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

        const result = await agent.generate(params["Body"] || "", {
            threadId: threadId,
            resourceId: profile.id
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
            to: `whatsapp:+${params["WaId"]}`,
            body: "Lo siento, tuve un error técnico. Intenta más tarde.",
        });
    }
}