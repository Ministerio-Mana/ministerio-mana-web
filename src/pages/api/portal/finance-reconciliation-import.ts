import type { APIRoute } from 'astro';
import { getFinanceAccessContext } from '@lib/financeAccess';
import type { FinanceProvider } from '@lib/providerReconciliation';
import {
  parseProviderReportCsv,
  PROVIDER_REPORT_MAX_BYTES,
  serializeProviderReportForRpc,
} from '@lib/providerReportImport';
import { supabaseAdmin } from '@lib/supabaseAdmin';

export const prerender = false;

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function formValue(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function parseProviderHint(value: string): FinanceProvider | null {
  const provider = value.toUpperCase();
  if (!provider || provider === 'AUTO') return null;
  if (provider === 'WOMPI' || provider === 'STRIPE') return provider;
  throw new Error('Proveedor inválido.');
}

function canImportProvider(provider: FinanceProvider, financeContext: Awaited<ReturnType<typeof getFinanceAccessContext>>): boolean {
  if (financeContext.access.isGlobal) return true;
  return provider === 'WOMPI' && financeContext.access.countryKeys.includes('colombia');
}

function isMissingImportContract(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST202'
    || code === '42P01'
    || code === '42883'
    || message.includes('import_finance_provider_report_secure')
    || message.includes('finance_provider_import_batches');
}

export const POST: APIRoute = async ({ request }) => {
  if (!supabaseAdmin) return json({ ok: false, error: 'La conexión financiera del servidor no está configurada.' }, 500);
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== requestUrl.origin) return json({ ok: false, error: 'Origen de solicitud inválido.' }, 403);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > PROVIDER_REPORT_MAX_BYTES + 256_000) {
    return json({ ok: false, error: 'El archivo CSV supera 4 MB.' }, 413);
  }

  const financeContext = await getFinanceAccessContext(request);
  if (!financeContext.ok) return json({ ok: false, error: financeContext.error }, financeContext.status);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'No fue posible leer el archivo.' }, 400);
  }

  const action = formValue(form, 'action').toLowerCase() || 'preview';
  if (!['preview', 'commit'].includes(action)) return json({ ok: false, error: 'Acción inválida.' }, 400);

  let providerHint: FinanceProvider | null;
  try {
    providerHint = parseProviderHint(formValue(form, 'provider'));
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Proveedor inválido.' }, 400);
  }

  const entry = form.get('report');
  if (!(entry instanceof File)) return json({ ok: false, error: 'Selecciona un archivo CSV.' }, 400);
  if (!entry.name.toLowerCase().endsWith('.csv')) return json({ ok: false, error: 'El reporte debe ser un archivo CSV.' }, 415);
  if (entry.size < 1) return json({ ok: false, error: 'El archivo CSV está vacío.' }, 400);
  if (entry.size > PROVIDER_REPORT_MAX_BYTES) return json({ ok: false, error: 'El archivo CSV supera 4 MB.' }, 413);

  let report;
  try {
    report = parseProviderReportCsv({
      bytes: new Uint8Array(await entry.arrayBuffer()),
      sourceFileName: entry.name,
      providerHint,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'El reporte no es válido.',
    }, 400);
  }

  if (!canImportProvider(report.preview.provider, financeContext)) {
    return json({
      ok: false,
      error: report.preview.provider === 'STRIPE'
        ? 'Solo Finanzas Global puede importar reportes de Stripe.'
        : 'Solo Finanzas Global o Nacional Colombia puede importar reportes de Wompi.',
    }, 403);
  }

  const duplicateResult = await supabaseAdmin
    .from('finance_provider_import_batches')
    .select('id, imported_at, row_count')
    .eq('provider', report.preview.provider)
    .eq('report_type', report.preview.reportType)
    .eq('file_sha256', report.preview.fileSha256)
    .maybeSingle();

  if (duplicateResult.error && isMissingImportContract(duplicateResult.error)) {
    return json({
      ok: false,
      error: 'Falta activar el contrato de importación financiera en Supabase.',
      migrationRequired: true,
      preview: report.preview,
    }, 503);
  }
  if (duplicateResult.error) {
    console.error('[finance-reconciliation-import] duplicate lookup failed', {
      code: duplicateResult.error.code,
      message: duplicateResult.error.message,
    });
    return json({ ok: false, error: 'No fue posible validar si el reporte ya se importó.' }, 500);
  }

  const duplicate = duplicateResult.data
    ? {
      batchId: duplicateResult.data.id,
      importedAt: duplicateResult.data.imported_at,
      rowCount: duplicateResult.data.row_count,
    }
    : null;

  if (action === 'preview') {
    return json({
      ok: true,
      action: 'preview',
      preview: report.preview,
      duplicate,
      canCommit: !duplicate,
    });
  }

  if (duplicate) {
    return json({
      ok: false,
      error: 'Este mismo archivo ya fue importado. No se creó un segundo lote.',
      duplicate,
    }, 409);
  }

  const confirmationSha256 = formValue(form, 'confirmationSha256').toLowerCase();
  if (confirmationSha256 !== report.preview.fileSha256) {
    return json({ ok: false, error: 'La vista previa cambió. Vuelve a revisar el archivo antes de importarlo.' }, 409);
  }

  const rpcPayload = serializeProviderReportForRpc(report);
  const { data, error } = await supabaseAdmin.rpc('import_finance_provider_report_secure', {
    p_provider: rpcPayload.provider,
    p_report_type: rpcPayload.reportType,
    p_file_sha256: rpcPayload.fileSha256,
    p_source_file_name: rpcPayload.sourceFileName,
    p_row_count: rpcPayload.rowCount,
    p_period_start: rpcPayload.periodStart,
    p_period_end: rpcPayload.periodEnd,
    p_settlements: rpcPayload.settlements,
    p_transactions: rpcPayload.transactions,
    p_imported_by: financeContext.userId,
    p_notes: report.preview.exactNet
      ? 'Reporte con valores exactos del proveedor.'
      : 'Reporte de ventas con comisión y neto pendientes del reporte de desembolsos.',
  });

  if (error && isMissingImportContract(error)) {
    return json({
      ok: false,
      error: 'Falta ejecutar docs/sql/finance_provider_report_import.sql en Supabase.',
      migrationRequired: true,
    }, 503);
  }
  if (error) {
    console.error('[finance-reconciliation-import] atomic import failed', {
      code: error.code,
      message: error.message,
    });
    return json({
      ok: false,
      error: 'El archivo fue rechazado completo; no se guardó una carga parcial. Revisa que no contradiga datos ya conciliados.',
    }, 409);
  }

  if (data?.duplicate) {
    return json({
      ok: false,
      error: 'Este mismo archivo ya fue importado. No se creó un segundo lote.',
      duplicate: data,
    }, 409);
  }

  return json({
    ok: true,
    action: 'commit',
    result: data,
    preview: report.preview,
  });
};
