import { registerApiRoute } from "@mastra/core/server";
import { InvopopClient } from "../invopop/invopop-client";
import { supabase } from "../supabase";
import { twilio } from "../twilio";
import { PinoLogger } from "@mastra/loggers";

const logger = new PinoLogger({ name: 'InvopopVerifactuWebhook', level: 'info' });

interface InvopopVerifactuWebhookBody {
    "id": string;
    "event": 'registered' | 'completed' | 'error';
    "transform_job_id": string;
    "silo_entry_id": string;
}

export const invopopVerifactuWebhook = registerApiRoute("/invopop/verifactu/webhook", {
    method: "POST",
    handler: async (c) => {
        const body: InvopopVerifactuWebhookBody = await c.req.json();
        logger.info("Invopop Verifactu Webhook received", { body });
        const invopopClient = new InvopopClient();
        const siloEntry = await invopopClient.getSiloEntryById(body.silo_entry_id);
        logger.info("Silo entry", { siloEntry });
        const profileId = siloEntry?.data?.doc?.meta?.user;
        
        if (!profileId) {
            return c.json({ error: 'Profile ID not found' }, 404);
        }

        const { data: profile, error: profileError } = await supabase.from('profiles')
            .select('id, name, email, phone, invopop_data, verifactu_completed, verifactu_status').eq('id', profileId).single();

        if (profileError) {
            return c.json({ error: profileError.message }, 500);
        }


        if (!profile) {
            return c.json({ error: 'Profile not found' }, 404);
        }

        const updateData: any = {
            verifactu_status: body.event as 'registered' | 'completed' | 'error',
        };

        switch (body.event) {
            case 'registered':
                await twilio.messages.create({
                    from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
                    to: `whatsapp:+${profile.phone}`,
                    body: 'Tus datos para el registro de Veri*Factu se han enviado para su verificación, recibirás una notificación cuando el proceso esté completado.',
                });
                break;
            case 'completed':
                await twilio.messages.create({
                    from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
                    to: `whatsapp:+${profile.phone}`,
                    body: `¡Enhorabuena! Tu registro de Veri*Factu ha sido completado. Ahora puedes generar facturas y documentos fiscales!`,
                });
                break;
            case 'error':
                await twilio.messages.create({
                    from: `whatsapp:+${process.env.TWILIO_FROM_NUMBER!}`,
                    to: `whatsapp:+${profile.phone}`,
                    body: `Lo sentimos, tu registro de Veri*Factu ha fallado. Por favor, intentalo de nuevo.`,
                });
                break;
        }

        updateData.verifactu_status = body.event as 'processing' | 'completed' | 'error';
        updateData.verifactu_completed = body.event === 'completed';

        await supabase.from('profiles').update(updateData).eq('id', profileId);
        return c.json({ message: "Webhook received" }, 200);
    },
});

