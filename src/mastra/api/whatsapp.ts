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
                logger.error("Invalid Twilio signature", { twilioSignature, url, params });
                //return c.text("Unauthorized", 403);
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
            // Send typing indicator to show the user we're processing
            // Note: Typing indicators are in Beta and may not work for all accounts
            // The "invalid or incomplete inbound data in MDR" error suggests the message
            // might not be fully processed yet or the API isn't available for this account
            if (messageSid && messageSid.startsWith('SM')) {
                try {
                    // First, verify the message exists by fetching it
                    // This ensures the message is fully processed in Twilio's system
                    try {
                        const message = await client.messages(messageSid).fetch();
                        logger.info("Message verified", { 
                            messageSid,
                            status: message.status,
                            direction: message.direction
                        });
                    } catch (fetchError: any) {
                        logger.warn("Could not fetch message for verification", { 
                            messageSid,
                            error: fetchError?.message 
                        });
                        // Continue anyway - message might still be valid
                    }
                    
                    logger.info("Attempting to send typing indicator", { 
                        messageId: messageSid,
                        channel: 'whatsapp',
                        from,
                        to
                    });
                    
                    await client.messaging.v2.typingIndicator.create({
                        messageId: messageSid,
                        channel: 'whatsapp',
                    });
                    logger.info("Typing indicator sent successfully", { messageSid });
                } catch (typingError: any) {
                    // Extract detailed error information from Twilio
                    const errorDetails: any = {
                        messageId: messageSid,
                        channel: 'whatsapp',
                    };
                    
                    if (typingError?.status) {
                        errorDetails.status = typingError.status;
                        errorDetails.statusText = typingError.statusText;
                    }
                    
                    if (typingError?.code) {
                        errorDetails.code = typingError.code;
                    }
                    
                    if (typingError?.message) {
                        errorDetails.message = typingError.message;
                    }
                    
                    if (typingError?.moreInfo) {
                        errorDetails.moreInfo = typingError.moreInfo;
                    }
                    
                    // Try to get the response body if available
                    if (typingError?.response?.body) {
                        errorDetails.responseBody = typingError.response.body;
                    }
                    
                    // Check if it's the MDR error - if so, typing indicators might not be supported
                    if (typingError?.message?.includes('MDR') || typingError?.message?.includes('incomplete inbound data')) {
                        logger.warn("Typing indicators may not be available for this account or message type", errorDetails);
                    } else {
                        logger.warn("Failed to send typing indicator", errorDetails);
                    }
                    // Continue processing even if typing indicator fails
                }
            } else {
                logger.warn("Invalid message SID for typing indicator", { 
                    messageSid,
                    isValid: messageSid?.startsWith('SM'),
                    messageBody: messageBody.substring(0, 50) // First 50 chars for context
                });
            }

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
                const sendErrorDetails = sendError instanceof Error
                    ? {
                        message: sendError.message,
                        stack: sendError.stack,
                        name: sendError.name,
                    }
                    : { error: String(sendError) };
                logger.error("Error sending error message:", sendErrorDetails);
            }
            
            return c.text("Internal Server Error", 500);
        }
    },
})