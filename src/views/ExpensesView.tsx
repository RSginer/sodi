import type { FC } from 'hono/jsx';

type ExpenseItem = {
  id: string;
  createdAt: string;
  goblInvoice: any;
  sourceImageUrl?: string | null;
};

const formatCurrency = (amount: number, currency: string = 'EUR') => {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const Layout: FC<{ title: string; children?: any }> = (props) => {
  return (
    <html>
      <head>
        <title>{props.title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      </head>
      <body class="min-h-screen bg-slate-50 text-slate-900 font-[system-ui]">
        {props.children}
      </body>
    </html>
  );
};

const ExpensesView: FC<{
  userName: string;
  profileId: string;
  fromDate: string;
  toDate: string;
  expenses: ExpenseItem[];
}> = (props) => {
  const title = `Gastos de ${props.userName || 'usuario'}`;

  return (
    <Layout title={title}>
      <div class="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-5 sm:max-w-2xl sm:px-6">
        <header class="mb-4">
          <h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h1>
          <p class="mt-2 text-base text-slate-500 sm:text-lg">
            Filtra tus gastos por fecha de factura y revisa los tickets registrados.
          </p>
        </header>

        <section class="mb-4 rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
          <form
            method="get"
            action="/expenses"
            class="flex flex-col gap-4"
          >
            <input type="hidden" name="profileId" value={props.profileId} />
            <label class="flex w-full flex-col text-sm font-medium text-slate-700">
              Desde
              <input
                type="date"
                name="fromDate"
                value={props.fromDate}
                class="mt-2  rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label class="flex w-full flex-col text-sm font-medium text-slate-700">
              Hasta
              <input
                type="date"
                name="toDate"
                value={props.toDate}
                class="mt-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <button
              type="submit"
              class="mt-1 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:brightness-110 sm:mt-0 sm:w-auto sm:px-6 sm:text-lg"
            >
              Filtrar
            </button>
          </form>
        </section>

        <section class="flex-1">
          {props.expenses.length === 0 ? (
            <div class="mt-6 rounded-2xl bg-white/80 px-4 py-10 text-center text-base text-slate-500 shadow-inner sm:text-lg">
              No hay gastos registrados para el rango seleccionado.
            </div>
          ) : (
            <div class="mt-4 flex flex-col gap-3 pb-6 sm:gap-4">
              {props.expenses.map((e) => {
                const invoice = e.goblInvoice || {};
                const supplier = invoice.supplier || {};
                const supplierName: string =
                  (supplier.name as string | undefined) ??
                  (supplier.party?.name as string | undefined) ??
                  'Sin proveedor';

                const supplierTaxId: string | null =
                  (supplier.tax_id?.code as string | undefined) ?? null;

                const issueDate: string | null = invoice.issue_date ?? null;
                const currency: string | null = invoice.currency ?? null;

                // Totales: usamos payable, luego total_with_tax, luego sum (todas strings)
                let totalAmount: number | null = null;
                const totals = invoice.totals;
                if (totals) {
                  if (typeof totals.payable === 'string') {
                    totalAmount = parseFloat(totals.payable);
                  } else if (typeof totals.total_with_tax === 'string') {
                    totalAmount = parseFloat(totals.total_with_tax);
                  } else if (typeof totals.sum === 'string') {
                    totalAmount = parseFloat(totals.sum);
                  }
                }

                // IVA: intentamos extraer el primer percent de totals.taxes.categories[0].rates[0].percent
                let ivaRatePercent: number | null = null;
                const percentStr: string | undefined =
                  totals?.taxes?.categories?.[0]?.rates?.[0]?.percent;
                if (typeof percentStr === 'string') {
                  const cleaned = percentStr.replace('%', '').trim();
                  const parsed = parseFloat(cleaned);
                  ivaRatePercent = Number.isFinite(parsed) ? parsed : null;
                }

                return (
                  <article class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 class="text-lg font-semibold text-slate-900 sm:text-xl">
                          {supplierName}
                        </h2>
                        {supplierTaxId && (
                          <p class="mt-1 text-sm text-slate-500">
                            CIF: <span class="font-mono">{supplierTaxId}</span>
                          </p>
                        )}
                      </div>
                      <p class="text-xl font-bold text-blue-600 sm:text-2xl">
                        {typeof totalAmount === 'number'
                          ? formatCurrency(totalAmount, currency || 'EUR')
                          : '-'}
                      </p>
                    </div>

                    <div class="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-600 sm:grid-cols-2 sm:text-base">
                      {issueDate && (
                        <div class="flex gap-2">
                          <span class="font-medium text-slate-500">Fecha factura:</span>
                          <span>{issueDate}</span>
                        </div>
                      )}
                      {typeof ivaRatePercent === 'number' && (
                        <div class="flex gap-2">
                          <span class="font-medium text-slate-500">IVA:</span>
                          <span>{ivaRatePercent}%</span>
                        </div>
                      )}
                    </div>

                    <div class="mt-3 flex items-center justify-between gap-3">
                      <p class="text-xs text-slate-400 sm:text-sm">
                        Registrado:{' '}
                        {new Date(e.createdAt).toLocaleString('es-ES', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    {e.sourceImageUrl && (
                      <a
                        href={e.sourceImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:brightness-110"
                      >
                        Descargar ticket
                      </a>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
};

export default ExpensesView;

