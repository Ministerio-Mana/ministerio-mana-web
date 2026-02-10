import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';
import { ensureUserProfile, listUserMemberships } from '@lib/portalAuth';
import { readPasswordSession } from '@lib/portalPasswordSession';
import {
    normalizeCountryGroup,
    currencyForGroup,
    sanitizeParticipant,
    calculateTotals,
    depositThreshold,
    generateAccessToken,
    type PackageType,
} from '@lib/cumbre2026';
import { buildDepositSchedule, buildInstallmentSchedule, getInstallmentDeadline, isValidDateOnly, type InstallmentFrequency } from '@lib/cumbreInstallments';
import { applyManualPaymentToPlan, createPaymentPlan, recordPayment, recomputeBookingTotals } from '@lib/cumbreStore';
import { normalizeCityName, normalizeChurchName } from '@lib/normalization';
import { sanitizePlainText, containsBlockedSequence } from '@lib/validation';
import { buildDonationReference, createDonation } from '@lib/donationsStore';

export const prerender = false;

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

function packageTypeFromAge(ageRaw: unknown, lodgingRaw: unknown): PackageType {
    const age = Number(ageRaw || 0);
    const lodging = String(lodgingRaw || '').toLowerCase() !== 'no_lodging' && String(lodgingRaw || '').toLowerCase() !== 'no';
    if (age <= 4) return 'child_0_7';
    if (age <= 10) return 'child_7_13';
    return lodging ? 'lodging' : 'no_lodging';
}

export const POST: APIRoute = async ({ request }) => {
    if (!supabaseAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), { status: 500 });
    }

    // RBAC Authorization (Same as bookings.ts)
    let isAllowed = false;
    let isAdmin = false;
    let allowedChurchId: string | null = null;
    let allowedCountry: string | null = null;
    let profile: any = null;

    const user = await getUserFromRequest(request);
    if (!user?.email) {
        const passwordSession = readPasswordSession(request);
        if (!passwordSession?.email) {
            return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401 });
        }
        isAllowed = true;
        isAdmin = true;
    } else {
        profile = await ensureUserProfile(user);
        if (!profile) {
            return new Response(JSON.stringify({ ok: false, error: 'Perfil no encontrado' }), { status: 403 });
        }

        const memberships = await listUserMemberships(user.id);
        const activeMembership = memberships.find((m: any) =>
            ['church_admin', 'church_member'].includes(m?.role) && m?.status !== 'pending',
        );
        const hasChurchRole = Boolean(activeMembership);

        const role = profile.role || 'user';
        const allowedRoles = ['superadmin', 'admin', 'national_pastor', 'pastor', 'local_collaborator', 'church_admin'];

        // STRICT: Block regular users
        if (!allowedRoles.includes(role) && !hasChurchRole) {
            return new Response(JSON.stringify({ ok: false, error: 'No tienes permisos para registrar participantes' }), { status: 403 });
        }

        if (role === 'superadmin' || role === 'admin') {
            isAdmin = true;
            isAllowed = true;
        } else if (role === 'national_pastor') {
            // National Pastor: Can register in ANY church in their country
            isAllowed = true;
            allowedCountry = profile.country;
            if (!allowedCountry) {
                return new Response(JSON.stringify({ ok: false, error: 'Sin país asignado' }), { status: 403 });
            }
        } else {
            // Local Pastor / Collaborator: ONLY their assigned church
            isAllowed = true;
            allowedChurchId = profile.church_id || activeMembership?.church?.id || null;
            if (!allowedChurchId) {
                return new Response(JSON.stringify({ ok: false, error: 'Sin iglesia asignada' }), { status: 403 });
            }
        }
    }

    // Parse request body
    const body = await request.json().catch(() => null);
    if (!body) {
        return new Response(JSON.stringify({ ok: false, error: 'Payload inválido' }), { status: 400 });
    }

    const participantsRaw = Array.isArray(body.participants) ? body.participants : [];
    if (participantsRaw.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: 'Agrega al menos un participante' }), { status: 400 });
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

    let contactCountry = sanitizePlainText(body.country ?? '', 40);
    let contactCity = normalizeCityName(body.city ?? '');
    const manualChurchNameRaw = sanitizePlainText(body.manual_church_name ?? body.manualChurchName ?? '', 120);
    const rawChurchId = body.church_id ?? body.churchId ?? '';
    const rawChurchIdLower = String(rawChurchId || '').toLowerCase();

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
        if (rawChurchIdLower === 'virtual') {
            resolvedChurchName = 'Ministerio Maná Virtual';
        } else if (rawChurchIdLower === 'none') {
            resolvedChurchName = 'No asisto a ninguna iglesia';
            skipChurchCreate = true;
        }
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

    if (!resolvedChurchId && resolvedChurchName && isAdmin && !skipChurchCreate) {
        const { data: existing } = await supabaseAdmin
            .from('churches')
            .select('id, name')
            .ilike('name', resolvedChurchName)
            .maybeSingle();
        if (existing?.id) {
            resolvedChurchId = existing.id;
            resolvedChurchName = existing.name || resolvedChurchName;
        } else {
            const { data: created } = await supabaseAdmin
                .from('churches')
                .insert({
                    name: resolvedChurchName,
                    city: contactCity || null,
                    country: contactCountry || null,
                    created_by: user?.id || null,
                })
                .select('id, name')
                .single();
            if (created?.id) {
                resolvedChurchId = created.id;
                resolvedChurchName = created.name || resolvedChurchName;
            }
        }
    }

    if (!isAdmin) {
        if (allowedChurchId) {
            if (!resolvedChurchId || resolvedChurchId !== allowedChurchId) {
                return new Response(JSON.stringify({ ok: false, error: 'Solo puedes registrar en tu iglesia asignada' }), { status: 403 });
            }
        } else if (allowedCountry) {
            if (!resolvedChurchId) {
                return new Response(JSON.stringify({ ok: false, error: 'Solo puedes registrar en iglesias de tu país' }), { status: 403 });
            }
            const { data: church, error: churchError } = await supabaseAdmin
                .from('churches')
                .select('country')
                .eq('id', resolvedChurchId)
                .single();

            if (churchError || !church || church.country !== allowedCountry) {
                return new Response(JSON.stringify({ ok: false, error: 'Solo puedes registrar en iglesias de tu país' }), { status: 403 });
            }
        }
    }

    if (!resolvedChurchId && !resolvedChurchName) {
        return new Response(JSON.stringify({ ok: false, error: 'Selecciona una iglesia para continuar' }), { status: 400 });
    }

    const participants = participantsRaw
        .map((participant: any) => {
            const age = Number(participant?.age ?? 0);
            const packageChoice = participant?.packageType ?? participant?.package_type ?? 'lodging';
            const packageType = Number.isFinite(age) ? packageTypeFromAge(age, packageChoice) : packageChoice;
            const relationship = participant?.isLeader ? 'responsable' : 'acompanante';
            const documentType = normalizeDocType(participant?.document_type ?? participant?.documentType ?? '');
            const documentNumber = sanitizePlainText(participant?.document_number ?? participant?.documentNumber ?? '', 50);
            const safe = sanitizeParticipant({
                fullName: participant?.name ?? participant?.full_name ?? '',
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
    const tokenPair = generateAccessToken();

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

    const autoPlan = paymentOption === 'FULL' && paymentAmount > 0 && paymentAmount < totalAmount;
    const planOption = autoPlan ? 'INSTALLMENTS' : paymentOption;

    if (paymentAmount < 0) {
        return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede ser negativo' }), { status: 400 });
    }

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
            source: 'portal-iglesia',
            church_id: resolvedChurchId || null,
            created_by: user?.id || profile?.user_id || null,
        })
        .select('id')
        .single();

    if (bookingError || !booking) {
        console.error('Error inserting bookings:', bookingError);
        return new Response(JSON.stringify({ ok: false, error: 'Error al crear registros' }), { status: 500 });
    }

    const participantRows = participants.map((participant) => ({
        booking_id: booking.id,
        full_name: participant.safe.fullName,
        package_type: participant.safe.packageType,
        relationship: participant.safe.relationship,
        document_type: participant.safe.documentType,
        document_number: participant.safe.documentNumber,
        birthdate: participant.extra?.birthdate || null,
        gender: sanitizePlainText(participant.extra?.gender ?? '', 20) || null,
        diet_type: sanitizePlainText(participant.extra?.menu ?? '', 40) || null,
    }));

    const { error: participantError } = await supabaseAdmin
        .from('cumbre_participants')
        .insert(participantRows);

    if (participantError) {
        return new Response(JSON.stringify({ ok: false, error: 'No se pudo guardar participantes' }), { status: 500 });
    }

    if (paymentAmount > totalAmount) {
        return new Response(JSON.stringify({ ok: false, error: 'El monto pagado no puede superar el total' }), { status: 400 });
    }

    const remainingAmount = Math.max(totalAmount - paymentAmount, 0);

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
        const reference = buildDonationReference();
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

    await recomputeBookingTotals(booking.id);

    return new Response(
        JSON.stringify({
            ok: true,
            message: `Grupo registrado exitosamente (${participants.length} participante${participants.length > 1 ? 's' : ''})`,
            booking_id: booking.id,
        }),
        { status: 200 }
    );
};
