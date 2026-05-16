import type { APIRoute } from 'astro';
import { enforceRateLimit } from '@lib/rateLimit';
import { sanitizeDescription, validateCopAmount, validateUsdAmount } from '@lib/donations';
import { resolveBaseUrl } from '@lib/url';
import { createStripeCustomer, createStripeDonationSession, createStripeInstallmentSession } from '@lib/stripe';
import { buildWompiCheckoutUrl } from '@lib/wompi';
import { logPaymentEvent, logSecurityEvent } from '@lib/securityEvents';
import { buildDonationReference, createDonation } from '@lib/donationsStore';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { MISIONEROS } from '@data/misioneros';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile } from '@lib/portalAuth';
import { DOCUMENT_TYPES_ANY, normalizeDocumentType } from '@lib/donationInput';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { createCampusSubscription } from '@lib/campusSubscriptions';

export const prerender = false;

function normalizeMissionaryName(value: string): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function asText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
}

function normalizeMoneyAmount(value: unknown, currency: 'COP' | 'USD'): number {
    let amount: number;
    if (typeof value === 'string') {
        const raw = value.trim();
        if (currency === 'COP') {
            const digits = raw.replace(/[^\d]/g, '');
            amount = digits ? Number(digits) : 0;
        } else {
            let normalized = raw.replace(/[^0-9.,]/g, '');
            if (normalized.includes(',') && !normalized.includes('.')) {
                normalized = normalized.replace(',', '.');
            } else {
                normalized = normalized.replace(/,/g, '');
            }
            amount = Number(normalized);
        }
    } else {
        amount = Number(value);
    }
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return currency === 'COP'
        ? Math.round(amount)
        : Math.round(amount * 100) / 100;
}

function buildAllocationAmounts(params: {
    selectedSlugs: string[];
    allocations: unknown;
    amount: unknown;
    currency: 'COP' | 'USD';
}): { slug: string; amount: number }[] {
    const { selectedSlugs, allocations, amount, currency } = params;

    if (Array.isArray(allocations) && allocations.length > 0) {
        const bySlug = new Map<string, number>();
        allocations.forEach((item: any) => {
            const slug = asText(item?.slug).trim();
            if (!selectedSlugs.includes(slug)) return;
            const allocationAmount = normalizeMoneyAmount(item?.amount, currency);
            if (allocationAmount > 0) bySlug.set(slug, allocationAmount);
        });

        return selectedSlugs.map((slug) => ({
            slug,
            amount: bySlug.get(slug) || 0,
        }));
    }

    const legacyAmount = normalizeMoneyAmount(amount, currency);
    return selectedSlugs.map((slug) => ({ slug, amount: legacyAmount }));
}

/**
 * POST /api/campus/checkout
 *
 * Accepts JSON:
 * {
 *   missionaries: string[],   // array of slugs
 *   amount: number,           // legacy per-missionary amount
 *   allocations?: { slug: string, amount: number }[],
 *   currency: "COP" | "USD",
 *   frequency: "monthly" | "once",
 *   fullName: string,
 *   email: string,
 *   phone: string,
 *   city?: string,
 * }
 *
 * Creates a SINGLE checkout session (Wompi or Stripe) with:
 * - Total amount = sum of allocations, or legacy amount × missionaries.length
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
            allocations,
            currency,
            frequency,
            fullName,
            email,
            phone,
            city,
            documentType,
            documentNumber,
        } = body;
        const isRecurring = frequency === 'monthly';
        const user = await getUserFromRequest(request);

        if (isRecurring && !user?.email) {
            return json({
                ok: false,
                requiresAccount: true,
                error: 'Para una siembra mensual necesitas iniciar sesión o crear una cuenta.',
            }, 401);
        }

        const profile = user ? await ensureUserProfile(user) : null;
        const donorFullName = sanitizePlainText(
            asText(fullName || profile?.full_name || (user?.user_metadata as any)?.full_name || ''),
            120,
        );
        const donorEmail = (
            user?.email
            || email
            || profile?.email
            || ''
        ).toString().trim().toLowerCase();
        const donorPhone = sanitizePlainText(asText(phone || profile?.phone || ''), 30);
        const donorCity = sanitizePlainText(asText(city || profile?.city || ''), 80);
        const donorDocumentType = normalizeDocumentType(
            asText(documentType || profile?.document_type || ''),
            DOCUMENT_TYPES_ANY,
        ) || '';
        const donorDocumentNumber = sanitizePlainText(
            asText(documentNumber || profile?.document_number || ''),
            40,
        );

        // Validate required fields
        if (!Array.isArray(missionaries) || missionaries.length === 0) {
            return json({ ok: false, error: 'Selecciona al menos un misionero' }, 400);
        }
        if (!['COP', 'USD'].includes(currency)) {
            return json({ ok: false, error: 'Moneda no soportada' }, 400);
        }
        const normalizedCurrency = currency as 'COP' | 'USD';
        if ((!Array.isArray(allocations) || allocations.length === 0) && normalizeMoneyAmount(amount, normalizedCurrency) <= 0) {
            return json({ ok: false, error: 'Monto inválido' }, 400);
        }
        if (!donorFullName) {
            return json({ ok: false, error: 'Nombre requerido' }, 400);
        }
        if (!donorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail)) {
            return json({ ok: false, error: 'Email inválido' }, 400);
        }
        if (currency === 'COP') {
            if (!donorDocumentType) {
                return json({ ok: false, error: 'Tipo de identificación requerido para pagos en Colombia' }, 400);
            }
            if (!donorDocumentNumber) {
                return json({ ok: false, error: 'Número de identificación requerido para pagos en Colombia' }, 400);
            }
        }
        const blocked = [
            donorFullName,
            donorEmail,
            donorPhone,
            donorCity,
            donorDocumentNumber,
        ].some((value) => containsBlockedSequence(value));
        if (blocked) {
            return json({ ok: false, error: 'Datos inválidos' }, 400);
        }

        // Validate missionary slugs
        const validSlugs = new Set(MISIONEROS.map(m => m.slug));
        const selectedSlugs: string[] = Array.from(new Set(
            missionaries.filter((s: string) => validSlugs.has(s)),
        ));
        if (selectedSlugs.length === 0) {
            return json({ ok: false, error: 'Misioneros no válidos' }, 400);
        }

        const allocationAmounts = buildAllocationAmounts({
            selectedSlugs,
            allocations,
            amount,
            currency: normalizedCurrency,
        });
        if (allocationAmounts.some((allocation) => allocation.amount <= 0)) {
            return json({ ok: false, error: 'Ingresa un monto para cada misionero seleccionado' }, 400);
        }

        // Build missionary names for description
        const selectedNames = selectedSlugs.map(slug => {
            const m = MISIONEROS.find(x => x.slug === slug);
            return m?.nombre || slug;
        });

        const totalAmount = allocationAmounts.reduce((sum, allocation) => sum + allocation.amount, 0);
        const equalAmounts = allocationAmounts.every((allocation) => allocation.amount === allocationAmounts[0]?.amount);
        const amountMode = Array.isArray(allocations) && allocations.length > 0 && !equalAmounts ? 'custom' : 'same';
        const allocationBySlug = new Map(allocationAmounts.map((allocation) => [allocation.slug, allocation.amount]));

        const selectedMissionaries = selectedSlugs.map((slug, index) => ({
            slug,
            name: selectedNames[index],
            userId: null as string | null,
        }));

        if (supabaseAdmin) {
            const { data: campusProfiles } = await supabaseAdmin
                .from('user_profiles')
                .select('user_id, full_name, role')
                .eq('role', 'campus_missionary');

            const byName = new Map<string, string>();
            (campusProfiles || []).forEach((profile: any) => {
                const normalized = normalizeMissionaryName(profile?.full_name || '');
                if (!normalized || byName.has(normalized)) return;
                if (profile?.user_id) byName.set(normalized, String(profile.user_id));
            });

            selectedMissionaries.forEach((missionary) => {
                const normalized = normalizeMissionaryName(missionary.name);
                missionary.userId = byName.get(normalized) || null;
            });
        }

        const missionaryName = selectedMissionaries.length === 1
            ? selectedMissionaries[0].name
            : selectedMissionaries.map((m) => m.name).join(', ');
        const missionaryId = selectedMissionaries.length === 1
            ? selectedMissionaries[0].userId
            : null;
        const description = sanitizeDescription(
            `Campus Maná - ${selectedNames.join(', ')}`,
            'Donación Campus Maná',
        );

        const baseUrl = resolveBaseUrl(request);
        const reference = buildDonationReference({ domain: 'CAMPUS' });

        if (user?.id && supabaseAdmin) {
            const profileUpdates: Record<string, any> = {
                updated_at: new Date().toISOString(),
            };
            if (donorFullName) profileUpdates.full_name = donorFullName;
            if (donorPhone) profileUpdates.phone = donorPhone;
            if (donorCity) profileUpdates.city = donorCity;
            if (currency === 'COP') profileUpdates.country = 'CO';
            if (donorDocumentType) profileUpdates.document_type = donorDocumentType;
            if (donorDocumentNumber) profileUpdates.document_number = donorDocumentNumber;

            await supabaseAdmin
                .from('user_profiles')
                .update(profileUpdates)
                .eq('user_id', user.id);
        }

        // Store donation record
        const donation = await createDonation({
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
            church: profile?.church_name || '',
            church_city: donorCity,
            donor_name: donorFullName,
            donor_email: donorEmail,
            donor_phone: donorPhone,
            donor_document_type: donorDocumentType,
            donor_document_number: donorDocumentNumber,
            is_recurring: isRecurring,
            donor_country: currency === 'COP' ? 'CO' : (profile?.country || ''),
            donor_city: donorCity,
            donation_description: description,
            need_certificate: false,
            source: 'campus-multi-donation',
            cumbre_booking_id: null,
            missionary_id: missionaryId,
            missionary_name: missionaryName,
            raw_event: {
                missionaries: selectedSlugs,
                missionaryMatches: selectedMissionaries.map((m) => ({
                    slug: m.slug,
                    name: m.name,
                    userId: m.userId,
                })),
                amountMode,
                amountPerMissionary: amountMode === 'same' ? allocationAmounts[0]?.amount || 0 : null,
                allocations: allocationAmounts,
                totalAmount,
                frequency,
                userId: user?.id || null,
            },
        });

        let checkoutUrl: string;
        let campusSubscriptionId = '';
        let stripeCustomerId = '';

        if (currency === 'COP') {
            // Wompi checkout
            try {
                validateCopAmount(totalAmount);
            } catch (e: any) {
                return json({ ok: false, error: e?.message || 'Monto COP inválido' }, 400);
            }

            const redirect = new URL(`${baseUrl}/campus/gracias`);
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
                email: donorEmail,
                customerData: {
                    country: 'CO',
                    city: donorCity,
                    'full-name': donorFullName,
                    'phone-number': donorPhone,
                    'legal-id': donorDocumentNumber,
                    'legal-id-type': donorDocumentType,
                },
            });

            checkoutUrl = url;

            if (isRecurring && user?.id) {
                const subscription = await createCampusSubscription({
                    userId: user.id,
                    status: 'PENDING_SETUP',
                    provider: 'wompi',
                    amount: totalAmount,
                    currency: 'COP',
                    donorName: donorFullName,
                    donorEmail,
                    donorPhone,
                    donorDocumentType,
                    donorDocumentNumber,
                    donorCity,
                    donorCountry: 'CO',
                    providerReference: reference,
                    lastDonationId: donation.id,
                    metadata: {
                        source: 'campus-checkout',
                        note: 'Wompi requires tokenized payment source before automatic monthly charges.',
                    },
                    allocations: selectedMissionaries.map((missionary) => ({
                        missionary_slug: missionary.slug,
                        missionary_name: missionary.name,
                        missionary_id: missionary.userId,
                        amount: allocationBySlug.get(missionary.slug) || 0,
                        currency: 'COP',
                    })),
                });
                campusSubscriptionId = subscription.id;
            }

            void logPaymentEvent('wompi', 'campus-multi.created', reference, {
                amount: totalAmount,
                currency: 'COP',
                missionaries: selectedSlugs,
                allocations: allocationAmounts,
                campus_subscription_id: campusSubscriptionId || null,
            });

        } else {
            // Stripe checkout
            try {
                validateUsdAmount(totalAmount);
            } catch (e: any) {
                return json({ ok: false, error: e?.message || 'Monto USD inválido' }, 400);
            }

            const successUrl = `${baseUrl}/campus/gracias?ref=${reference}&provider=stripe`;
            const cancelUrl = `${baseUrl}/campus`;

            const metadata = {
                source: 'campus-multi-donation',
                donation_reference: reference,
                donation_id: donation.id,
                missionaries: selectedSlugs.join(','),
                amount_mode: amountMode,
                amount_per_missionary: amountMode === 'same' ? String(allocationAmounts[0]?.amount || '') : 'variable',
                allocation_summary: allocationAmounts.map((item) => `${item.slug}:${item.amount}`).join(','),
                portal_user_id: user?.id || '',
            };

            let session;
            if (isRecurring) {
                const customer = await createStripeCustomer({
                    email: donorEmail,
                    name: donorFullName,
                    metadata: {
                        portal_user_id: user?.id || '',
                        source: 'campus-monthly',
                    },
                });
                stripeCustomerId = customer.id;
                const subscription = await createCampusSubscription({
                    userId: user!.id,
                    status: 'PENDING',
                    provider: 'stripe',
                    amount: totalAmount,
                    currency: 'USD',
                    donorName: donorFullName,
                    donorEmail,
                    donorPhone,
                    donorDocumentType,
                    donorDocumentNumber,
                    donorCity,
                    donorCountry: profile?.country || '',
                    providerCustomerId: stripeCustomerId,
                    providerReference: reference,
                    lastDonationId: donation.id,
                    metadata: {
                        source: 'campus-checkout',
                    },
                    allocations: selectedMissionaries.map((missionary) => ({
                        missionary_slug: missionary.slug,
                        missionary_name: missionary.name,
                        missionary_id: missionary.userId,
                        amount: allocationBySlug.get(missionary.slug) || 0,
                        currency: 'USD',
                    })),
                });
                campusSubscriptionId = subscription.id;
                session = await createStripeInstallmentSession({
                    amount: totalAmount,
                    currency: 'USD',
                    description,
                    interval: 'month',
                    intervalCount: 1,
                    successUrl,
                    cancelUrl,
                    metadata: {
                        ...metadata,
                        campus_subscription_id: campusSubscriptionId,
                    },
                    customerId: stripeCustomerId,
                });
            } else {
                session = await createStripeDonationSession({
                    amountUsd: totalAmount,
                    currency: 'USD',
                    description,
                    successUrl,
                    cancelUrl,
                    metadata,
                    customerEmail: donorEmail,
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
                allocations: allocationAmounts,
                session_id: session.id,
                campus_subscription_id: campusSubscriptionId || null,
            });
        }

        return json({ ok: true, url: checkoutUrl, reference, campusSubscriptionId: campusSubscriptionId || null });

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
