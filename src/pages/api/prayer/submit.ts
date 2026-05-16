import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { verifyTurnstile } from '@lib/turnstile';
import { enforceRateLimit } from '@lib/rateLimit';
import { logSecurityEvent } from '@lib/securityEvents';
import { safeCountry } from '@lib/donations';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const form = await request.formData();
    const firstNameRaw = (form.get('firstName') as string) || '';
    const requestRaw = ((form.get('requestText') || form.get('request') || form.get('petition')) as string) || '';
    const cityRaw = (form.get('city') as string) || '';
    const countryRaw = (form.get('country') as string) || '';

    if (
      containsBlockedSequence(firstNameRaw) ||
      containsBlockedSequence(requestRaw) ||
      containsBlockedSequence(cityRaw) ||
      containsBlockedSequence(countryRaw)
    ) {
      return new Response(JSON.stringify({ ok: false, error: 'No se permiten enlaces en las peticiones.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const firstName = sanitizePlainText(firstNameRaw, 60);
    const requestText = sanitizePlainText(requestRaw, 280);
    const city = sanitizePlainText(cityRaw, 80);
    const country = sanitizePlainText(countryRaw, 80);
    const captchaToken = form.get('cf-turnstile-response')?.toString();

    if (!firstName) {
      return new Response(JSON.stringify({ ok: false, error: 'Nombre requerido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!requestText) {
      return new Response(JSON.stringify({ ok: false, error: 'Escribe una petición para orar.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const turnstileConfigured = !import.meta.env.DEV && Boolean(
      import.meta.env?.TURNSTILE_SECRET_KEY ?? process.env?.TURNSTILE_SECRET_KEY,
    );
    if (turnstileConfigured) {
      const okCaptcha = await verifyTurnstile(captchaToken, clientAddress);
      if (!okCaptcha) {
        void logSecurityEvent({
          type: 'captcha_failed',
          identifier: 'prayer.submit',
          ip: clientAddress,
          detail: 'Turnstile inválido',
        });
        return new Response(JSON.stringify({ ok: false, error: 'Captcha inválido' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const allowed = await enforceRateLimit(`prayer:${clientAddress ?? 'unknown'}`);
    if (!allowed) {
      void logSecurityEvent({
        type: 'rate_limited',
        identifier: `prayer:${clientAddress ?? 'unknown'}`,
        ip: clientAddress,
        detail: 'Prayer submit',
      });
      return new Response(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }

    const cityClean = city ? city.replace(/[^\p{L}\p{N}\s\.,-]+/gu, '').trim() : null;
    const countryCode = safeCountry(country) ?? null;
    const payload = {
      first_name: firstName,
      request_text: requestText,
      city: cityClean,
      country: countryCode,
      prayers_count: 0,
      approved: true,
    };

    if (!supabaseAdmin) {
      const row = {
        ...payload,
        id: `local-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      return new Response(JSON.stringify({ ok: true, simulated: true, row }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data, error } = await supabaseAdmin
      .from('prayer_requests')
      .insert(payload)
      .select('id,first_name,request_text,city,country,prayers_count,created_at')
      .single();

    if (error) {
      void logSecurityEvent({
        type: 'payment_error',
        identifier: 'prayer.submit',
        ip: clientAddress,
        detail: 'Supabase insert error',
        meta: { error: error.message },
      });
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, row: data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error: any) {
    void logSecurityEvent({
      type: 'payment_error',
      identifier: 'prayer.submit',
      ip: clientAddress,
      detail: error?.message || 'Prayer submit error',
    });
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'Error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
