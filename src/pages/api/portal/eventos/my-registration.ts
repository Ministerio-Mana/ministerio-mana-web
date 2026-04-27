import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@lib/supabaseAdmin';
import { getUserFromRequest } from '@lib/supabaseAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
    if (!supabaseAdmin) {
        return new Response(JSON.stringify({ ok: false, error: 'Supabase no configurado' }), { status: 500 });
    }

    // Get authenticated user
    const user = await getUserFromRequest(request);
    if (!user?.email) {
        return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), { status: 401 });
    }

    try {
        // Find user's booking by email
        // They could be the leader (registered_by) or a participant (email match)
        const { data: bookings, error: bookingError } = await supabaseAdmin
            .from('cumbre_bookings')
            .select('*')
            .eq('email', user.email)
            .order('created_at', { ascending: false });

        if (bookingError) {
            console.error('Error fetching bookings:', bookingError);
            return new Response(JSON.stringify({ ok: false, error: 'Error al consultar inscripción' }), { status: 500 });
        }

        // If no booking found, user is not enrolled
        if (!bookings || bookings.length === 0) {
            return new Response(JSON.stringify({
                ok: true,
                enrolled: false
            }), { status: 200 });
        }

        // Get the most recent booking (could be multiple if re-registered)
        const myBooking = bookings[0];
        const groupId = myBooking.booking_group_id;

        // Get all participants in the same group
        const { data: groupMembers } = await supabaseAdmin
            .from('cumbre_bookings')
            .select('*')
            .eq('booking_group_id', groupId)
            .order('is_leader', { ascending: false }); // Leader first

        // Get installments for this group
        const { data: installments } = await supabaseAdmin
            .from('cumbre_payment_plans')
            .select('*')
            .eq('booking_group_id', groupId)
            .order('due_date', { ascending: true });

        // Calculate totals
        const totalAmount = (groupMembers || []).reduce((sum, m) => sum + (m.amount || 0), 0);

        // Get payments made for this group
        const { data: payments } = await supabaseAdmin
            .from('cumbre_payments')
            .select('*')
            .eq('booking_group_id', groupId);

        const totalPaid = (payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);

        // Payment status
        const isPaidFull = myBooking.payment_status === 'PAID' || totalPaid >= totalAmount;
        const pendingInstallments = (installments || []).filter(i => i.status === 'PENDING');

        return new Response(JSON.stringify({
            ok: true,
            enrolled: true,
            booking: myBooking,
            group: {
                id: groupId,
                members: groupMembers || [],
                memberCount: (groupMembers || []).length
            },
            payment: {
                totalAmount,
                totalPaid,
                isPaidFull,
                paymentMethod: myBooking.payment_method,
                paymentStatus: myBooking.payment_status
            },
            installments: {
                all: installments || [],
                pending: pendingInstallments,
                pendingCount: pendingInstallments.length
            }
        }), { status: 200 });

    } catch (error) {
        console.error('Unexpected error in my-registration:', error);
        return new Response(JSON.stringify({ ok: false, error: 'Error inesperado' }), { status: 500 });
    }
};
