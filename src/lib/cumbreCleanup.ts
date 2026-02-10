import { supabaseAdmin } from './supabaseAdmin';

export async function cleanupCumbreBooking(bookingId: string): Promise<void> {
  if (!supabaseAdmin || !bookingId) return;
  try {
    await supabaseAdmin
      .from('donations')
      .delete()
      .eq('cumbre_booking_id', bookingId);
  } catch (error) {
    console.warn('[cumbre.cleanup] donations', error);
  }
  const { error } = await supabaseAdmin
    .from('cumbre_bookings')
    .delete()
    .eq('id', bookingId);
  if (error) {
    console.warn('[cumbre.cleanup] booking', error);
  }
}
