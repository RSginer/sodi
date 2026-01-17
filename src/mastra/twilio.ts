import twilioClient from "twilio";
import TwilioMessagingResponse from "twilio/lib/twiml/MessagingResponse";

export const twilio = twilioClient(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!, {
    logLevel: "debug",
});

export const MessagingResponse = TwilioMessagingResponse;