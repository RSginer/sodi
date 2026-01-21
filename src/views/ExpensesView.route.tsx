import { registerApiRoute } from '@mastra/core/server';
import ExpensesView from './ExpensesView';
import { supabase } from '../mastra/supabase';
import { PinoLogger } from '@mastra/loggers';

const logger = new PinoLogger({
  name: 'ExpensesViewRoute',
  level: 'info',
});

export const route = registerApiRoute('/expenses', {
  method: 'GET',
  handler: async (c) => {
    const profileId = c.req.query('profileId') as string | null;
    const fromDateQuery = c.req.query('fromDate') as string | null;
    const toDateQuery = c.req.query('toDate') as string | null;

    if (!profileId) {
      return c.html(<h1>Perfil no encontrado</h1>);
    }

    const today = new Date();
    const toDefault = today.toISOString().slice(0, 10);
    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    const fromDefault = from.toISOString().slice(0, 10);

    const fromDate = fromDateQuery || fromDefault;
    const toDate = toDateQuery || toDefault;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile) {
      return c.html(<h1>Usuario no encontrado</h1>);
    }

    let query = supabase
      .from('expenses_invoices')
      .select('id, created_at, gobl_invoice, source_image_url')
      .eq('profile_id', profileId);

    if (fromDate) {
      query = query.gte('gobl_invoice->>issue_date', fromDate);
    }

    if (toDate) {
      query = query.lte('gobl_invoice->>issue_date', toDate);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(200);

    if (error) {
      logger.error('Error al obtener los gastos', { error: error.message });
      return c.html(<h1>Error al obtener los gastos</h1>);
    }

    const expenses =
      data?.map((row: any) => ({
        id: row.id as string,
        createdAt: row.created_at as string,
        goblInvoice: row.gobl_invoice,
        sourceImageUrl: (row.source_image_url as string | undefined) ?? null,
      })) ?? [];

    return c.html(
      <ExpensesView
        userName={profile.name || 'Usuario'}
        profileId={profile.id}
        fromDate={fromDate}
        toDate={toDate}
        expenses={expenses}
      />,
    );
  },
});

