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
        <style>
          {`
            dialog {
              margin: auto;
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
            }
            dialog::backdrop {
              background-color: rgba(0, 0, 0, 0.6);
            }
          `}
        </style>
      </head>
      <body class="min-h-screen bg-[#E5E5E5] text-[#111B21] font-[system-ui]">
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

  // Sumatorio del resultado de la búsqueda
  let totalGastado = 0;
  let totalIvaDeducible = 0;
  let aggregateCurrency: string | null = null;

  for (const e of props.expenses) {
    const invoice = (e as any).goblInvoice || {};
    const currency = invoice.currency as string | undefined;
    if (!aggregateCurrency && currency) {
      aggregateCurrency = currency;
    }

    const totals = invoice.totals;
    if (!totals) continue;

    // Total gastado: payable -> total_with_tax -> sum
    let totalStr: string | undefined;
    if (typeof totals.payable === 'string') {
      totalStr = totals.payable;
    } else if (typeof totals.total_with_tax === 'string') {
      totalStr = totals.total_with_tax;
    } else if (typeof totals.sum === 'string') {
      totalStr = totals.sum;
    }
    if (totalStr) {
      const v = parseFloat(totalStr);
      if (Number.isFinite(v)) {
        totalGastado += v;
      }
    }

    // Total IVA deducible: totals.tax -> totals.taxes.sum
    let ivaStr: string | undefined;
    if (typeof totals.tax === 'string') {
      ivaStr = totals.tax;
    } else if (typeof totals.taxes?.sum === 'string') {
      ivaStr = totals.taxes.sum;
    }
    if (ivaStr) {
      const v = parseFloat(ivaStr);
      if (Number.isFinite(v)) {
        totalIvaDeducible += v;
      }
    }
  }

  return (
    <Layout title={title}>
      <div class="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-5 sm:max-w-2xl sm:px-6">
        <header class="mb-4">
          <h1 class="text-xl font-semibold tracking-tight text-[#111B21] sm:text-3xl">
            {title}
          </h1>
          <p class="mt-2 text-sm text-[#667781] sm:text-base">
            Filtra tus gastos por fecha de factura y revisa los tickets registrados.
          </p>
        </header>

        {props.expenses.length > 0 && (
          <section class="mb-3 rounded-lg bg-white p-4 shadow-sm sm:p-5">
            <h2 class="mb-2 text-sm font-semibold text-[#111B21]">
              Resumen del periodo
            </h2>
            <div class="flex flex-col gap-1 text-xs text-[#667781] sm:flex-row sm:items-baseline sm:justify-between sm:text-sm">
              <div>
                <span class="font-medium">Total gastado:</span>
                <span class="ml-1 font-semibold text-[#111B21]">
                  {formatCurrency(totalGastado, aggregateCurrency || 'EUR')}
                </span>
              </div>
              <div>
                <span class="font-medium">Total IVA deducible:</span>
                <span class="ml-1 font-semibold text-[#25D366]">
                  {formatCurrency(totalIvaDeducible, aggregateCurrency || 'EUR')}
                </span>
              </div>
            </div>
          </section>
        )}

        <section class="mb-4 rounded-lg bg-white p-4 shadow-sm sm:p-5">
          <form
            method="get"
            action="/expenses"
            class="flex flex-col gap-4"
          >
            <input type="hidden" name="profileId" value={props.profileId} />
            <label class="flex w-full flex-col text-sm font-medium text-[#111B21]">
              Desde
              <input
                type="date"
                name="fromDate"
                value={props.fromDate}
                class="mt-2 rounded-lg border border-[#D1D7DB] bg-white px-3 py-2 text-sm text-[#111B21] outline-none transition focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366]"
              />
            </label>
            <label class="flex w-full flex-col text-sm font-medium text-[#111B21]">
              Hasta
              <input
                type="date"
                name="toDate"
                value={props.toDate}
                class="mt-2 rounded-lg border border-[#D1D7DB] bg-white px-3 py-2 text-sm text-[#111B21] outline-none transition focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366]"
              />
            </label>
            <button
              type="submit"
              class="mt-2 w-full rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#20BA5A] sm:mt-0 sm:w-auto"
            >
              Filtrar
            </button>
          </form>
        </section>

        <section class="flex-1">
          {props.expenses.length === 0 ? (
            <div class="mt-6 rounded-lg bg-white px-4 py-10 text-center text-sm text-[#667781] sm:text-base">
              No hay gastos registrados para el rango seleccionado.
            </div>
          ) : (
            <div class="mt-4 flex flex-col gap-2 pb-6 sm:gap-3">
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

                // Total de IVA pagado: usamos totals.tax o totals.taxes.sum (todas strings)
                let ivaTotalAmount: number | null = null;
                if (totals) {
                  if (typeof totals.tax === 'string') {
                    ivaTotalAmount = parseFloat(totals.tax);
                  } else if (typeof totals.taxes?.sum === 'string') {
                    ivaTotalAmount = parseFloat(totals.taxes.sum);
                  }
                }

                const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
                const dialogId = `lines-${e.id}`;

                return (
                  <article class="rounded-lg bg-white p-3 shadow-sm sm:p-4">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 class="text-base font-medium text-[#111B21] sm:text-lg">
                          {supplierName}
                        </h2>
                        {supplierTaxId && (
                          <p class="mt-0.5 text-xs text-[#667781]">
                            CIF: <span class="font-mono">{supplierTaxId}</span>
                          </p>
                        )}
                      </div>
                      <p class="text-lg font-semibold text-[#25D366] sm:text-xl">
                        {typeof totalAmount === 'number'
                          ? formatCurrency(totalAmount, currency || 'EUR')
                          : '-'}
                      </p>
                    </div>

                    <div class="mt-2 grid grid-cols-1 gap-1.5 text-xs text-[#667781] sm:grid-cols-2 sm:text-sm">
                      {issueDate && (
                        <div class="flex gap-1.5">
                          <span class="font-medium">Fecha factura:</span>
                          <span>{issueDate}</span>
                        </div>
                      )}
                      {typeof ivaRatePercent === 'number' && (
                        <div class="flex gap-1.5">
                          <span class="font-medium">IVA:</span>
                          <span>{ivaRatePercent}%</span>
                        </div>
                      )}
                      {typeof ivaTotalAmount === 'number' && (
                        <div class="flex gap-1.5">
                          <span class="font-medium">Total IVA:</span>
                          <span class="font-semibold">
                            {formatCurrency(ivaTotalAmount, currency || 'EUR')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        class="inline-flex items-center rounded-lg border border-[#D1D7DB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111B21] transition hover:bg-[#F5F6F6]"
                        onclick={`document.getElementById('${dialogId}')?.showModal()`}
                      >
                        Ver líneas
                      </button>

                      {e.sourceImageUrl && (
                        <a
                          href={e.sourceImageUrl}
                          download
                          class="inline-flex items-center rounded-lg bg-[#25D366] px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#20BA5A]"
                        >
                          Descargar ticket
                        </a>
                      )}

                      <p class="ml-auto text-xs text-[#667781]">
                        {new Date(e.createdAt).toLocaleString('es-ES', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    <dialog
                      id={dialogId}
                      class="w-[90vw] max-w-4xl rounded-lg border border-[#D1D7DB] bg-white p-0 shadow-2xl backdrop:bg-black/50"
                    >
                      <div class="flex items-center justify-between border-b border-[#E5E5E5] bg-[#F0F2F5] px-4 py-3">
                        <h3 class="text-sm font-semibold text-[#111B21] sm:text-base">
                          Líneas del ticket
                        </h3>
                        <button
                          type="button"
                          class="rounded-lg px-2 py-1 text-xs font-medium text-[#667781] transition hover:bg-[#E5E5E5] hover:text-[#111B21]"
                          onclick={`document.getElementById('${dialogId}')?.close()`}
                        >
                          ✕ Cerrar
                        </button>
                      </div>

                      <div class="max-h-[60vh] overflow-auto px-4 py-3">
                        {lines.length === 0 ? (
                          <p class="text-sm text-[#667781]">
                            No se han encontrado líneas en este ticket.
                          </p>
                        ) : (
                          <table class="min-w-full border-collapse text-left text-xs text-[#111B21] sm:text-sm">
                            <thead>
                              <tr class="border-b border-[#E5E5E5] bg-[#F5F6F6]">
                                <th class="px-2 py-2 font-medium text-[#667781]">#</th>
                                <th class="px-2 py-2 font-medium text-[#667781]">Concepto</th>
                                <th class="px-2 py-2 font-medium text-right text-[#667781]">Cantidad</th>
                                <th class="px-2 py-2 font-medium text-right text-[#667781]">Precio</th>
                                <th class="px-2 py-2 font-medium text-right text-[#667781]">IVA</th>
                                <th class="px-2 py-2 font-medium text-right text-[#667781]">Total con IVA</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((line: any, idx: number) => {
                                const lineQuantity =
                                  typeof line.quantity === 'string'
                                    ? line.quantity
                                    : line.quantity?.toString?.() ?? '';
                                const lineItem = line.item || {};
                                const lineName = (lineItem.name as string | undefined) ?? '';
                                const linePrice =
                                  typeof lineItem.price === 'string'
                                    ? lineItem.price
                                    : lineItem.price?.toString?.() ?? '';

                                const linePercentStr: string | undefined =
                                  line.taxes?.[0]?.percent;
                                const lineIva =
                                  typeof linePercentStr === 'string'
                                    ? linePercentStr
                                    : '';

                                // Cálculos numéricos para el total con IVA
                                const quantityNum = parseFloat(
                                  lineQuantity.replace(',', '.')
                                );
                                const priceNum = parseFloat(
                                  linePrice.replace(',', '.')
                                );
                                const ivaNum = (() => {
                                  if (typeof linePercentStr !== 'string') return 0;
                                  const cleaned = linePercentStr
                                    .replace('%', '')
                                    .trim();
                                  const parsed = parseFloat(cleaned);
                                  return Number.isFinite(parsed) ? parsed : 0;
                                })();

                                const totalWithIvaNum =
                                  Number.isFinite(quantityNum) &&
                                  Number.isFinite(priceNum)
                                    ? quantityNum * priceNum * (1 + ivaNum / 100)
                                    : NaN;

                                const lineTotal = Number.isFinite(totalWithIvaNum)
                                  ? totalWithIvaNum.toFixed(2)
                                  : '';

                                return (
                                  <tr
                                    class={idx % 2 === 0 ? 'border-b border-[#E5E5E5]' : 'border-b border-[#E5E5E5] bg-[#F5F6F6]'}
                                  >
                                    <td class="px-2 py-1.5 text-[#667781]">
                                      {(line.i as number | undefined) ?? idx + 1}
                                    </td>
                                    <td class="px-2 py-1.5">
                                      <div class="max-w-[16rem] truncate sm:max-w-xs">
                                        {lineName || <span class="text-[#667781]">Sin descripción</span>}
                                      </div>
                                    </td>
                                    <td class="px-2 py-1.5 text-right tabular-nums">
                                      {lineQuantity || '-'}
                                    </td>
                                    <td class="px-2 py-1.5 text-right tabular-nums">
                                      {Number.isFinite(priceNum)
                                        ? formatCurrency(priceNum, invoice.currency || 'EUR')
                                        : '-'}
                                    </td>
                                    <td class="px-2 py-1.5 text-right tabular-nums">
                                      {lineIva || '-'}
                                    </td>
                                    <td class="px-2 py-1.5 text-right tabular-nums font-medium">
                                      {Number.isFinite(totalWithIvaNum)
                                        ? formatCurrency(totalWithIvaNum, invoice.currency || 'EUR')
                                        : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </dialog>
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

