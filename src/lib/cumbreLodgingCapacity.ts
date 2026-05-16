import { supabaseAdmin } from './supabaseAdmin';
import {
  CUMBRE_LODGING_CAPACITY,
  CUMBRE_LODGING_REOPENED_AT,
  buildLodgingCapacityMessage,
  countRequestedLodging,
  getRemainingLodgingSlots,
} from './cumbre2026';

type ParticipantLike = {
  packageType?: string | null;
  package_type?: string | null;
};

export type LodgingCapacityStatus = {
  capacity: number;
  used: number;
  remaining: number;
  available: boolean;
};

export type LodgingCapacityCheck = LodgingCapacityStatus & {
  ok: boolean;
  requested: number;
  message?: string;
};

export function getLodgingReopenedAt(): string {
  return process.env.CUMBRE_LODGING_REOPENED_AT || CUMBRE_LODGING_REOPENED_AT;
}

export function isReopenedLodgingCreatedAt(createdAt: string | null | undefined): boolean {
  const createdTime = Date.parse(createdAt || '');
  const reopenedTime = Date.parse(getLodgingReopenedAt());
  return Number.isFinite(createdTime) && Number.isFinite(reopenedTime) && createdTime >= reopenedTime;
}

export async function getLodgingCapacityStatus(): Promise<LodgingCapacityStatus> {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }

  const { count, error } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id', { count: 'exact', head: true })
    .eq('package_type', 'lodging')
    .gte('created_at', getLodgingReopenedAt());

  if (error) {
    throw error;
  }

  const used = count ?? 0;
  const remaining = getRemainingLodgingSlots(used);
  return {
    capacity: CUMBRE_LODGING_CAPACITY,
    used,
    remaining,
    available: remaining > 0,
  };
}

export async function checkLodgingCapacity(params: {
  participants: ParticipantLike[];
  currentBookingLodgingCount?: number;
  legacyLodgingCount?: number;
}): Promise<LodgingCapacityCheck> {
  const requested = Math.max(countRequestedLodging(params.participants) - Math.max(params.legacyLodgingCount ?? 0, 0), 0);
  const status = await getLodgingCapacityStatus();
  const currentBookingLodgingCount = Math.max(params.currentBookingLodgingCount ?? 0, 0);
  const effectiveUsed = Math.max(status.used - currentBookingLodgingCount, 0);
  const remaining = getRemainingLodgingSlots(effectiveUsed);

  if (requested === 0 || requested <= remaining) {
    return {
      ok: true,
      requested,
      capacity: status.capacity,
      used: effectiveUsed,
      remaining,
      available: remaining > 0,
    };
  }

  return {
    ok: false,
    requested,
    capacity: status.capacity,
    used: effectiveUsed,
    remaining,
    available: remaining > 0,
    message: buildLodgingCapacityMessage(remaining),
  };
}

export async function checkWrittenLodgingCapacity(bookingId: string): Promise<LodgingCapacityCheck> {
  if (!supabaseAdmin) {
    throw new Error('Supabase no configurado');
  }

  const { count: bookingLodgingCount, error } = await supabaseAdmin
    .from('cumbre_participants')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId)
    .eq('package_type', 'lodging');

  if (error) {
    throw error;
  }

  const requested = bookingLodgingCount ?? 0;
  const status = await getLodgingCapacityStatus();

  if (requested === 0 || status.used <= status.capacity) {
    return {
      ok: true,
      requested,
      ...status,
    };
  }

  return {
    ok: false,
    requested,
    ...status,
    message: buildLodgingCapacityMessage(0),
  };
}
