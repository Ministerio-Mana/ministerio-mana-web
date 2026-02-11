import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizeDescription, validateCopAmount, validateUsdAmount } from '@lib/donations';
import { resolveBaseUrl } from '@lib/url';
import { createStripeDonationSession, createStripeInstallmentSession } from '@lib/stripe';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { buildDonationReference, createDonation } from '@lib/donationsStore';
import { MISIONEROS } from '@data/misioneros';

export const prerender = false;

/**
 * POST /api/campus/checkout
 *
 * Accepts JSON:
 * {
 *   missionaries: string[],   // array of slugs
 *   amount: number,           // per-missionary amount
 *   currency: "COP" | "USD",
 *   frequency: "monthly" | "once",
 *   fullName: string,
 *   email: string,
 *   phone: string,
 *   city?: string,
 * }
 *
 * Creates a SINGLE checkout session (Wompi or Stripe) with:
 * - Total amount = amount × missionaries.length
 * - Description listing all selected missionaries
 * - Metadata tracking the campus donation
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
    const userAgent = request.headers.get('user-agent') || '';

    try {
        // Rate limiting
        const rateKey = `campus:${clientAddress ?? 'unknown'}`;
        const allowed = await enforceRateLimit(rateKey);
        if (!allowed) {
            void logSecurityEvent({
                type: 'rate_limited',
                identifier: rateKey,
                ip: clientAddress,
                userAgent,
                detail: 'Campus multi-checkout',
            });
            return json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' }, 429);
        }

        // Parse JSON body
        const body = await request.json().catch(() => null);
        if (!body) {
            return json({ ok: false, error: 'Datos inválidos' }, 400);
        }

        const {
            missionaries,
            amount,
            currency,
            frequency,
            fullName,
            email,
            phone,
            city,
        } = body;

        // Validate required fields
        if (!Array.isArray(missionaries) || missionaries.length === 0) {
            return json({ ok: false, error: 'Selecciona al menos un misionero' }, 400);
        }
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return json({ ok: false, error: 'Monto inválido' }, 400);
        }
        if (!['COP', 'USD'].includes(currency)) {
            return json({ ok: false, error: 'Moneda no soportada' }, 400);
        }
        if (!fullName?.trim()) {
            return json({ ok: false, error: 'Nombre requerido' }, 400);
        }
        if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json({ ok: false, error: 'Email inválido' }, 400);
        }

        // Validate missionary slugs
        const validSlugs = new Set(MISIONEROS.map(m => m.slug));
        const selectedSlugs: string[] = missionaries.filter((s: string) => validSlugs.has(s));
        if (selectedSlugs.length === 0) {
            return json({ ok: false, error: 'Misioneros no válidos' }, 400);
        }

        // Build missionary names for description
        const selectedNames = selectedSlugs.map(slug => {
            const m = MISIONEROS.find(x => x.slug === slug);
            return m?.nombre || slug;
        });

        const totalAmount = amount * selectedSlugs.length;
        const isRecurring = frequency === 'monthly';
        const description = sanitizeDescription(
            `Campus Maná - ${selectedNames.join(', ')}`,
            'Donación Campus Maná',
        );

        const baseUrl = resolveBaseUrl(request);
        const reference = buildDonationReference();

        // Store donation record
        await createDonation({
            provider: currency === 'COP' ? 'wompi' : 'stripe',
            status: 'PENDING',
            amount: totalAmount,
            currency,
            reference,
            provider_tx_id: null,
            payment_method: null,
            donation_type: 'campus',
            project_name: `campus-multi:${selectedSlugs.join(',')}`,
            event_name: 'Campus Maná',
            campus: 'Campus Maná',
            church: '',
            church_city: city?.trim() || '',
            donor_name: fullName.trim(),
            donor_email: email.trim().toLowerCase(),
            donor_phone: phone?.trim() || '',
            donor_document_type: '',
            donor_document_number: '',
            is_recurring: isRecurring,
            donor_country: currency === 'COP' ? 'CO' : '',
            donor_city: city?.trim() || '',
            donation_description: description,
            need_certificate: false,
            source: 'campus-multi-donation',
            cumbre_booking_id: null,
            raw_event: JSON.stringify({
                missionaries: selectedSlugs,
                amountPerMissionary: amount,
                totalAmount,
                frequency,
            }),
        });

        let checkoutUrl: string;

        if (currency === 'COP') {
            // Wompi checkout
            try {
                validateCopAmount(totalAmount);
            } catch (e: any) {
                return json({ ok: false, error: e?.message || 'Monto COP inválido' }, 400);
            }

            const redirect = new URL(`${baseUrl}/donaciones/gracias`);
            redirect.searchParams.set('ref', reference);
            redirect.searchParams.set('provider', 'wompi');
            redirect.searchParams.set('type', 'campus');
            redirect.searchParams.set('amount', String(totalAmount));

            const { url } = buildWompiCheckoutUrl({
                amountInCents: totalAmount * 100,
                currency: 'COP',
                description,
                redirectUrl: redirect.toString(),
                reference,
                email: email.trim().toLowerCase(),
                customerData: {
                    'full-name': fullName.trim(),
                    'phone-number': phone?.trim() || '',
                },
            });

            checkoutUrl = url;

            void logPaymentEvent('wompi', 'campus-multi.created', reference, {
                amount: totalAmount,
                currency: 'COP',
                missionaries: selectedSlugs,
            });

        } else {
            // Stripe checkout
            try {
                validateUsdAmount(totalAmount);
            } catch (e: any) {
                return json({ ok: false, error: e?.message || 'Monto USD inválido' }, 400);
            }

            const successUrl = `${baseUrl}/donaciones/gracias?ref=${reference}&provider=stripe`;
            const cancelUrl = `${baseUrl}/campus`;

            const metadata = {
                source: 'campus-multi-donation',
                donation_reference: reference,
                missionaries: selectedSlugs.join(','),
                amount_per_missionary: String(amount),
            };

            let session;
            if (isRecurring) {
                session = await createStripeInstallmentSession({
                    amount: totalAmount,
                    currency: 'USD',
                    description,
                    interval: 'month',
                    intervalCount: 1,
                    successUrl,
                    cancelUrl,
                    metadata,
                    customerEmail: email.trim().toLowerCase(),
                });
            } else {
                session = await createStripeDonationSession({
                    amountUsd: totalAmount,
                    currency: 'USD',
                    description,
                    successUrl,
                    cancelUrl,
                    metadata,
                    customerEmail: email.trim().toLowerCase(),
                });
            }

            if (!session.url) {
                return json({ ok: false, error: 'No se pudo crear la sesión de pago' }, 500);
            }

            checkoutUrl = session.url;

            void logPaymentEvent('stripe', 'campus-multi.created', session.id, {
                amount: totalAmount,
                currency: 'USD',
                missionaries: selectedSlugs,
                session_id: session.id,
            });
        }

        return json({ ok: true, url: checkoutUrl, reference });

    } catch (error: any) {
        console.error('[campus.checkout] error', error);
        void logSecurityEvent({
            type: 'payment_error',
            identifier: 'campus.checkout',
            ip: clientAddress,
            userAgent,
            detail: error?.message || 'Campus checkout error',
        });
        return json({ ok: false, error: 'Error procesando el pago' }, 500);
    }
};

function json(data: any, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
