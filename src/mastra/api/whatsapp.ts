import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";

import { env } from "hono/adapter"
import twilio from "twilio";
const logger = new PinoLogger({
    name: 'WhatsappWebhook',
    level: 'info',
  });

export const whatsappWebhook = registerApiRoute("/whatsapp/webhook", {
    method: "POST",
    handler: async (c) => {
        const accountSid = env<{ TWILIO_ACCOUNT_SID: string }>(c).TWILIO_ACCOUNT_SID;
        const authToken = env<{ TWILIO_AUTH_TOKEN: string }>(c).TWILIO_AUTH_TOKEN;

        const client = twilio(accountSid, authToken);

        // Twilio sends form-encoded data, not JSON
        const formData = await c.req.formData();
        
        // Convert FormData to plain object for Twilio validation
        const params: Record<string, string> = {};
        formData.forEach((value, key) => {
            params[key] = value.toString();
        });
        
        // Validate the request is from Twilio (optional but recommended)
        const twilioSignature = c.req.header("X-Twilio-Signature");
        if (twilioSignature && authToken) {
            const url = c.req.url;
            const isValid = twilio.validateRequest(
                authToken,
                twilioSignature,
                url,
                params
            );
            
            if (!isValid) {
                return c.text("Unauthorized", 403);
            }
        }
        
        // Extract the message content and sender info
        const messageBody = params["Body"] || "";
        const from = params["From"] || "";
        const to = params["To"] || "";
        const messageSid = params["MessageSid"] || "";

        logger.info("Received message:", {
            body: messageBody,
            from,
            to,
            messageSid,
        });

        try {
            const agent = c.var.mastra.getAgent("weatherAgent");
            const response = await agent.generate([{
                role: "user",
                content: messageBody,
            }]);
        
            return c.text(response.text, 200);
        } catch (error) {
            console.error("Error processing WhatsApp message:", error);
            
            // Optionally send an error message to the user
            const whatsappNumber = to.replace("whatsapp:", "");
            const senderNumber = from.replace("whatsapp:", "");
            
            try {
                await client.messages.create({
                    from: `whatsapp:${whatsappNumber}`,
                    to: `whatsapp:${senderNumber}`,
                    body: "Sorry, I encountered an error processing your message. Please try again later.",
                });
            } catch (sendError) {
                console.error("Error sending error message:", sendError);
            }
            
            return c.text("Internal Server Error", 500);
        }
    },
})