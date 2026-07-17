import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getPortalChurchAccessContext, mapPortalAccessError } from '@lib/portalAccess';
import { isChurchAllowedForAccess } from '@lib/portalScope';
import {
    normalizeCountryGroup,
    currencyForGroup,
    sanitizeParticipant,
    calculateTotals,
    depositThreshold,
    buildPaymentReference,
    generateAccessToken,
    type PackageType,
} from '@lib/cumbre2026';
import { checkLodgingCapacity, checkWrittenLodgingCapacity } from '@lib/cumbreLodgingCapacity';
import { buildDepositSchedule, buildInstallmentSchedule, getInstallmentDeadline, isValidDateOnly, type InstallmentFrequency } from '@lib/cumbreInstallments';
import { applyManualPaymentToPlan, countPayments, createPaymentPlan, recordPayment, recomputeBookingTotals } from '@lib/cumbreStore';
import { normalizeCityName, normalizeChurchName, normalizeCountryRegion } from '@lib/normalization';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { createDonation } from '@lib/donationsStore';
import { cleanupCumbreBooking } from '@lib/cumbreCleanup';
import { buildIdempotencyKey } from '@lib/cumbreIdempotency';

export const prerender = false;

const VIRTUAL_CHURCH_NAME = 'Ministerio Maná Virtual';
const VIRTUAL_CHURCH_ALIASES = [VIRTUAL_CHURCH_NAME, 'Virtual'];

function normalizeFrequency(raw: string | null | undefined): InstallmentFrequency {
    const value = (raw || '').toString().trim().toUpperCase();
    if (value === 'BIWEEKLY' || value === 'QUINCENAL') return 'BIWEEKLY';
    return 'MONTHLY';
}

function isUuid(value: string | null | undefined): boolean {
    if (!value) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDocType(raw: unknown): string {
    const value = sanitizePlainText(String(raw || ''), 10).toUpperCase();
    if (value === 'PA') return 'PAS';
    return value;
}

function normalizeCurrency(raw: unknown): 'COP' | 'USD' | null {
    const value = String(raw || '').trim().toUpperCase();
    if (value === 'COP' || value === 'USD') return value;
    return null;
}

function normalizeEmail(raw: unknown): string | null {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function parseAmountForCurrency(raw: unknown, currency: 'COP' | 'USD'): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }
    const value = String(raw || '').trim();
    if (!value) return null;
    if (currency === 'COP') {
        const digits = value.replace(/[^\d]/g, '');
        if (!digits) return null;
        const amount = Number(digits);
        return Number.isFinite(amount) ? amount : null;
    }
    const normalized = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    if (!normalized) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
}

function resolveCountryGroup(rawCountryGroup: unknown, rawCountry: unknown): 'CO' | 'INT' {
    const source = (rawCountryGroup || rawCountry || '').toString().trim().toUpperCase();
    if (!source) return 'CO';
    if (source === 'VIRTUAL' || source === 'ONLINE' || source === 'N/A') return 'CO';
    return normalizeCountryGroup(source);
}

function ageFromBirthdate(raw: unknown): number | null {
    const value = String(raw || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map((part) => Number(part));
    const birth = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(birth.getTime())) return null;

    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
        age -= 1;
    }
    return age >= 0 ? age : null;
}

function resolveParticipantAge(participant: any): number | null {
    const rawAge = participant?.age;
    if (rawAge !== null && rawAge !== undefined && String(rawAge).trim() !== '') {
        const age = Number(rawAge);
        return Number.isFinite(age) ? age : null;
    }
    return ageFromBirthdate(participant?.birthdate);
}

function isNoLodgingChoice(raw: unknown): boolean {
    if (raw === false) return true;
    const value = String(raw ?? '').trim().toLowerCase();
    return ['no_lodging', 'no', 'false', '0', 'sin alojamiento', 'sin_alojamiento', 'without_lodging'].includes(value);
}

function packageTypeFromAge(ageRaw: unknown, lodgingRaw: unknown): PackageType {
    const age = Number(ageRaw);
    const lodging = !isNoLodgingChoice(lodgingRaw);
    if (Number.isFinite(age)) {
        if (age <= 4) return 'child_0_7';
        if (age <= 10) return 'child_7_13';
    }
    return lodging ? 'lodging' : 'no_lodging';
}

async function findIdempotentBooking(params: {
    idempotencyKey: string | null;
    expectedParticipants: number;
    churchId: string | null;
}) {
    if (!supabaseAdmin || !params.idempotencyKey) return null;
    let query = supabaseAdmin
        .from('cumbre_bookings')
        .select('id')
        .eq('idempotency_key', params.idempotencyKey);
    if (params.churchId) {
        query = query.eq('church_id', params.churchId);
    } else {
        query = query.is('church_id', null);
    }
    const { data: booking, error } = await query.maybeSingle();
    if (error || !booking?.id) return null;
    const { count, error: countError } = await supabaseAdmin
        .from('cumbre_participants')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', booking.id);
    if (countError) return null;
    if ((count ?? 0) >= params.expectedParticipants) {
        return booking;
    }
    await cleanupCumbreBooking(booking.id);
    return null;
}

export const POST: APIRoute = async ({ request }) => {
    if (!supabaseAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), { status: 500 });
    }

    const access = await getPortalChurchAccessContext(request);
    if (!access.ok) {
        const denied = mapPortalAccessError(access.reason, 'No tienes permisos para registrar participantes');
        return new Response(JSON.stringify({ ok: false, error: denied.error }), { status: denied.status });
    }
    const isAdmin = access.isAdmin;
    const allowedChurchId = access.allowedChurchId;
    const profile = access.profile;
    const actorUserId = access.userId;

    // Parse request body
    const body = await request.json().catch(() => null);
    if (!body) {
        return new Response(JSON.stringify({ ok: false, error: 'Payload inválido' }), { status: 400 });
    }

    const participantsRaw = Array.isArray(body.participants) ? body.participants : [];
    if (participantsRaw.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos un participante' }), { status: 400 });
    }

    const invalidEmail = participantsRaw.find((participant: any) => {
        const rawEmail = participant?.email ?? participant?.email_address ?? participant?.emailAddress;
        return rawEmail && !normalizeEmail(rawEmail);
    });
    if (invalidEmail) {
        return new Response(JSON.stringify({ ok: false, error: 'Email de participante inválido' }), { status: 400 });
    }

    const leader = participantsRaw.find((p: any) => p?.isLeader) || participantsRaw[0];
    const contactName = sanitizePlainText(leader?.name ?? '', 120);
    const contactEmail = (leader?.email ?? '').toString().trim().toLowerCase();
    const contactPhone = sanitizePlainText(leader?.phone ?? '', 30);
    const contactDocType = normalizeDocType(leader?.document_type ?? leader?.documentType ?? '');
    const contactDocNumber = sanitizePlainText(leader?.document_number ?? leader?.documentNumber ?? '', 40);

    if (!contactName || !contactPhone) {
        return new Response(JSON.stringify({ ok: false, error: 'Datos de contacto incompletos' }), { status: 400 });
    }

    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return new Response(JSON.stringify({ ok: false, error: 'Email inválido' }), { status: 400 });
    }

    if (containsBlockedSequence(contactName) || containsBlockedSequence(contactEmail) || containsBlockedSequence(contactPhone)) {
        return new Response(JSON.stringify({ ok: false, error: 'Datos inválidos' }), { status: 400 });
    }

    let contactCountry = normalizeCountryRegion(body.country ?? '');
    let contactCity = normalizeCityName(body.city ?? '');
    const manualChurchNameRaw = sanitizePlainText(body.manual_church_name ?? body.manualChurchName ?? '', 120);
    const rawChurchId = body.church_id ?? body.churchId ?? '';
    const rawChurchIdLower = String(rawChurchId || '').toLowerCase();
    const isVirtualSelection = rawChurchIdLower === 'virtual' || /virtual/i.test(manualChurchNameRaw);
    const normalizedCountry = contactCountry.trim();

    const paymentOption = (body.payment_option ?? body.paymentOption ?? 'FULL').toString().trim().toUpperCase();
    const depositDueDateRaw = (body.deposit_due_date ?? body.depositDueDate ?? '').toString().trim();
    const frequency = normalizeFrequency(body.installment_frequency ?? body.installmentFrequency);
    const currencyOverride = normalizeCurrency(body.currency ?? body.currencyCode);
    const paymentAmountRaw = body.payment_amount ?? body.paymentAmount;

    // STRICT RBAC: Validate requested church is within authorized scope
    let resolvedChurchId: string | null = isUuid(rawChurchId) ? String(rawChurchId) : null;
    let resolvedChurchName: string | null = null;
    let skipChurchCreate = false;

    if (!resolvedChurchId) {
        if (isVirtualSelection) {
            resolvedChurchName = VIRTUAL_CHURCH_NAME;
        } else if (rawChurchIdLower === 'none') {
            resolvedChurchName = 'No asisto a ninguna iglesia';
            skipChurchCreate = true;
        }
    }

    if (isVirtualSelection && !normalizedCountry) {
        return new Response(JSON.stringify({ ok: false, error: 'Escribe el país o región para Maná Virtual' }), { status: 400 });
    }

    if (!resolvedChurchName && manualChurchNameRaw) {
        resolvedChurchName = normalizeChurchName(manualChurchNameRaw);
    }

    if (resolvedChurchId) {
        const { data: church, error: churchError } = await supabaseAdmin
            .from('churches')
            .select('id, name, city, country')
            .eq('id', resolvedChurchId)
            .maybeSingle();

        if (churchError || !church) {
            return new Response(JSON.stringify({ ok: false, error: 'Iglesia no encontrada' }), { status: 404 });
        }

        resolvedChurchName = church.name || resolvedChurchName;
        if (!contactCity && church.city) {
            contactCity = church.city;
        }
        if (!contactCountry && church.country) {
            contactCountry = church.country;
        }
    }

    if (!resolvedChurchId && resolvedChurchName && contactCountry) {
        let existing: { id?: string; name?: string; city?: string } | null = null;
        if (isVirtualSelection) {
            for (const alias of VIRTUAL_CHURCH_ALIASES) {
                const { data } = await supabaseAdmin
                    .from('churches')
                    .select('id, name, city')
                    .ilike('name', alias)
                    .eq('country', contactCountry)
                    .maybeSingle();
                if (data?.id) {
                    existing = data;
                    break;
                }
            }
        } else {
            const { data } = await supabaseAdmin
                .from('churches')
                .select('id, name, city')
                .ilike('name', resolvedChurchName)
                .eq('country', contactCountry)
                .maybeSingle();
            if (data?.id) existing = data;
        }
        if (existing?.id) {
            resolvedChurchId = existing.id;
            resolvedChurchName = existing.name || resolvedChurchName;
            if (!contactCity && existing.city) {
                contactCity = existing.city;
            }
        }
    }

    if (!resolvedChurchId && resolvedChurchName && isAdmin && !skipChurchCreate) {
        let existing: { id?: string; name?: string } | null = null;
        if (isVirtualSelection) {
            for (const alias of VIRTUAL_CHURCH_ALIASES) {
                let query = supabaseAdmin
                    .from('churches')
                    .select('id, name')
                    .ilike('name', alias);
                if (contactCountry) {
                    query = query.eq('country', contactCountry);
                }
                const { data } = await query.maybeSingle();
                if (data?.id) {
                    existing = data;
                    break;
                }
            }
        } else {
            let query = supabaseAdmin
                .from('churches')
                .select('id, name')
                .ilike('name', resolvedChurchName);
            if (contactCountry) {
                query = query.eq('country', contactCountry);
            }
            const { data } = await query.maybeSingle();
            if (data?.id) existing = data;
        }
        if (existing?.id) {
            resolvedChurchId = existing.id;
            resolvedChurchName = existing.name || resolvedChurchName;
        }
    }

    if (!isAdmin) {
        if (allowedChurchId) {
            if (!resolvedChurchId || resolvedChurchId !== allowedChurchId) {
                return new Response(JSON.stringify({ ok: false, error: 'Solo puedes registrar en tu iglesia asignada' }), { status: 403 });
            }
        } else {
            const isAllowedChurch = await isChurchAllowedForAccess(resolvedChurchId, access);
            if (!isAllowedChurch) {
                return new Response(JSON.stringify({ ok: false, error: 'Solo puedes registrar en iglesias de tu alcance' }), { status: 403 });
            }
        }
    }

    if (!resolvedChurchId && !resolvedChurchName) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para continuar' }), { status: 400 });
    }

    const participants = participantsRaw
        .map((participant: any) => {
            const age = resolveParticipantAge(participant);
            const packageChoice = participant?.packageType
                ?? participant?.package_type
                ?? participant?.lodging
                ?? 'no_lodging';
            const packageType = packageTypeFromAge(age, packageChoice);
            const relationship = participant?.isLeader ? 'responsable' : 'acompanante';
            const documentType = normalizeDocType(participant?.document_type ?? participant?.documentType ?? '');
            const documentNumber = sanitizePlainText(participant?.document_number ?? participant?.documentNumber ?? '', 50);
            const safe = sanitizeParticipant({
                fullName: participant?.name ?? participant?.full_name ?? participant?.fullName ?? '',
                packageType,
                relationship,
                documentType,
                documentNumber,
            });
            if (!safe) return null;
            return {
                safe,
                extra: participant ?? {},
            };
        })
        .filter(Boolean) as { safe: NonNullable<ReturnType<typeof sanitizeParticipant>>; extra: any }[];

    if (!participants.length) {
        return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos una persona' }), { status: 400 });
    }
    let countryGroup = resolveCountryGroup(body.country_group ?? body.countryGroup, contactCountry);
    if (currencyOverride) {
        countryGroup = currencyOverride === 'USD' ? 'INT' : 'CO';
    }
    const currency = currencyOverride ?? currencyForGroup(countryGroup);
    const paymentAmountInput = parseAmountForCurrency(paymentAmountRaw, currency);
    const totalAmount = calculateTotals(currency, participants.map((p) => p.safe));
    const threshold = depositThreshold(totalAmount);

    let installmentSchedule: ReturnType<typeof buildInstallmentSchedule> | null = null;
    let paymentAmount = 0;
    if (paymentOption === 'FULL') {
        paymentAmount = totalAmount;
    } else if (paymentOption === 'DEPOSIT') {
        paymentAmount = threshold;
    } else if (paymentOption === 'INSTALLMENTS') {
        installmentSchedule = buildInstallmentSchedule({
            totalAmount,
            currency,
            frequency,
        });
        paymentAmount = installmentSchedule.installmentAmount;
    }

    if (paymentAmountInput != null) {
        paymentAmount = paymentAmountInput;
    }

    if (paymentAmount < 0) {
        return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede ser negativo' }), { status: 400 });
    }
    if (paymentAmount > totalAmount) {
        return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede superar el total' }), { status: 400 });
    }

    const remainingAmount = Math.max(totalAmount - paymentAmount, 0);
    const autoPlan = paymentOption === 'FULL' && paymentAmount > 0 && paymentAmount < totalAmount;
    const planOption = autoPlan ? 'INSTALLMENTS' : paymentOption;

    if (planOption === 'DEPOSIT') {
        if (!isValidDateOnly(depositDueDateRaw)) {
            return new Response(JSON.stringify({ ok: false, error: 'Fecha de segundo pago inválida' }), { status: 400 });
        }
        const deadline = getInstallmentDeadline();
        const today = new Date();
        const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (depositDueDateRaw < todayValue) {
            return new Response(JSON.stringify({ ok: false, error: 'La fecha del segundo pago debe ser futura' }), { status: 400 });
        }
        if (depositDueDateRaw > deadline) {
            return new Response(JSON.stringify({ ok: false, error: 'La fecha del segundo pago supera la fecha límite' }), { status: 400 });
        }
    }

    const idempotencySeed = JSON.stringify({
        source: 'portal-iglesia',
        contactEmail,
        contactPhone,
        contactName,
        totalAmount,
        currency,
        paymentAmount,
        planOption,
        frequency,
        depositDueDateRaw: depositDueDateRaw || null,
        churchId: resolvedChurchId,
        participants: participants.map((p) => ({
            fullName: p.safe.fullName,
            packageType: p.safe.packageType,
            relationship: p.safe.relationship,
            documentNumber: p.safe.documentNumber,
        })),
    });
    const idempotencyKey = buildIdempotencyKey({
        request,
        rawKey: body.idempotencyKey ?? body.idempotency_key,
        fallbackSeed: idempotencySeed,
    });

    const existingBooking = await findIdempotentBooking({
        idempotencyKey,
        expectedParticipants: participants.length,
        churchId: resolvedChurchId,
    });
    if (existingBooking) {
        return new Response(
            JSON.stringify({
                ok: true,
                message: `Grupo registrado exitosamente (${participants.length} participante${participants.length > 1 ? 's' : ''})`,
                booking_id: existingBooking.id,
                idempotent: true,
            }),
            { status: 200 }
        );
    }

    const lodgingCapacity = await checkLodgingCapacity({
        participants: participants.map((p) => p.safe),
    });
    if (!lodgingCapacity.ok) {
        return new Response(JSON.stringify({ ok: false, error: lodgingCapacity.message }), { status: 409 });
    }

    const tokenPair = generateAccessToken();

    const { data: booking, error: bookingError } = await supabaseAdmin
        .from('cumbre_bookings')
        .insert({
            contact_name: contactName,
            contact_email: contactEmail || null,
            contact_phone: contactPhone || null,
            contact_document_type: contactDocType || null,
            contact_document_number: contactDocNumber || null,
            contact_country: contactCountry || null,
            contact_city: contactCity || null,
            contact_church: resolvedChurchName || null,
            country_group: countryGroup,
            currency,
            total_amount: totalAmount,
            total_paid: 0,
            status: 'PENDING',
            deposit_threshold: threshold,
            payment_method: 'manual',
            token_hash: tokenPair.hash,
            idempotency_key: idempotencyKey,
            source: 'portal-iglesia',
            church_id: resolvedChurchId || null,
            created_by: actorUserId || profile?.user_id || null,
        })
        .select('id')
        .single();

    if (bookingError || !booking) {
        if (idempotencyKey) {
            const existing = await findIdempotentBooking({
                idempotencyKey,
                expectedParticipants: participants.length,
                churchId: resolvedChurchId,
            });
            if (existing) {
                return new Response(
                    JSON.stringify({
                        ok: true,
                        message: `Grupo registrado exitosamente (${participants.length} participante${participants.length > 1 ? 's' : ''})`,
                        booking_id: existing.id,
                        idempotent: true,
                    }),
                    { status: 200 }
                );
            }
        }
        console.error('Error inserting bookings:', bookingError);
        return new Response(JSON.stringify({ ok: false, error: 'Error al crear registros' }), { status: 500 });
    }

    try {
        const participantRows = participants.map((participant) => ({
            booking_id: booking.id,
            full_name: participant.safe.fullName,
            package_type: participant.safe.packageType,
            relationship: participant.safe.relationship,
            document_type: participant.safe.documentType,
            document_number: participant.safe.documentNumber,
            birthdate: participant.extra?.birthdate || null,
            gender: sanitizePlainText(participant.extra?.gender ?? '', 20) || null,
            diet_type: sanitizePlainText(participant.extra?.menu ?? participant.extra?.menuType ?? participant.extra?.diet_type ?? '', 40) || null,
            email: normalizeEmail(participant.extra?.email) || null,
        }));

        const { error: participantError } = await supabaseAdmin
            .from('cumbre_participants')
            .insert(participantRows);

        if (participantError) {
            throw new Error('No se pudo guardar participantes');
        }

        const writtenCapacity = await checkWrittenLodgingCapacity(booking.id);
        if (!writtenCapacity.ok) {
            await cleanupCumbreBooking(booking.id);
            return new Response(JSON.stringify({ ok: false, error: writtenCapacity.message }), { status: 409 });
        }

        let planId: string | null = null;
        if (planOption === 'INSTALLMENTS') {
            const schedule = installmentSchedule ?? buildInstallmentSchedule({
                totalAmount,
                currency,
                frequency,
            });

            const plan = await createPaymentPlan({
                bookingId: booking.id,
                frequency,
                startDate: schedule.startDate,
                endDate: schedule.endDate,
                totalAmount,
                currency,
                installmentCount: schedule.installmentCount,
                installmentAmount: schedule.installmentAmount,
                provider: 'manual',
                autoDebit: false,
                installments: schedule.installments,
            });
            planId = plan.id;
        } else if (planOption === 'DEPOSIT') {
            if (remainingAmount > 0) {
                const schedule = buildDepositSchedule({
                    totalAmount: remainingAmount,
                    currency,
                    dueDate: depositDueDateRaw,
                });
                const plan = await createPaymentPlan({
                    bookingId: booking.id,
                    frequency: 'DEPOSIT',
                    startDate: schedule.startDate,
                    endDate: schedule.endDate,
                    totalAmount: remainingAmount,
                    currency,
                    installmentCount: schedule.installmentCount,
                    installmentAmount: schedule.installmentAmount,
                    provider: 'manual',
                    autoDebit: false,
                    installments: schedule.installments,
                });
                planId = plan.id;
            }
        }

        if (paymentAmount > 0) {
            const paymentIndex = (await countPayments(booking.id)) + 1;
            const reference = buildPaymentReference(booking.id, paymentIndex);
            await recordPayment({
                bookingId: booking.id,
                provider: 'manual',
                providerTxId: null,
                reference,
                amount: paymentAmount,
                currency,
                status: 'APPROVED',
                planId,
                rawEvent: {
                    source: 'portal-iglesia',
                    method: 'manual',
                },
            });

            if (planId && planOption === 'INSTALLMENTS') {
                await applyManualPaymentToPlan({
                    planId,
                    amount: paymentAmount,
                    reference,
                });
            }

            await createDonation({
                provider: 'physical',
                status: 'APPROVED',
                amount: paymentAmount,
                currency,
                reference,
                provider_tx_id: null,
                payment_method: 'manual',
                donation_type: 'evento',
                project_name: 'Cumbre Mundial 2026',
                event_name: 'Cumbre Mundial 2026',
                campus: resolvedChurchName || null,
                church: resolvedChurchName || null,
                church_city: contactCity || null,
                donor_name: contactName,
                donor_email: contactEmail || null,
                donor_phone: contactPhone || null,
                donor_document_type: contactDocType || null,
                donor_document_number: contactDocNumber || null,
                is_recurring: false,
                donor_country: contactCountry || null,
                donor_city: contactCity || null,
                donation_description: null,
                need_certificate: false,
                source: 'portal-iglesia',
                cumbre_booking_id: booking.id,
                raw_event: null,
            });
        }

        try {
            await recomputeBookingTotals(booking.id);
        } catch (error) {
            console.error('[portal.iglesia.register-group] recompute error', error);
        }
    } catch (error) {
        await cleanupCumbreBooking(booking.id);
        console.error('Error inserting bookings:', error);
        return new Response(JSON.stringify({ ok: false, error: 'Error al crear registros' }), { status: 500 });
    }

    return new Response(
        JSON.stringify({
            ok: true,
            message: `Grupo registrado exitosamente (${participants.length} participante${participants.length > 1 ? 's' : ''})`,
            booking_id: booking.id,
        }),
        { status: 200 }
    );
};
