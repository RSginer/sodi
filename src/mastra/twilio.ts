import twilioClient from "twilio";

export const twilio = twilioClient(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!, {
    logLevel: "debug",
});

export const validateRequest = twilioClient.validateRequest;

export const MessagingResponse = twilioClient.twiml.MessagingResponse;