import { getPrice, isValidPackageType, type Currency, type PackageType } from './cumbre2026';

type BookingPackageSource = {
  currency?: string | null;
  total_amount?: number | string | null;
};

type ParticipantPackageSource = {
  id?: string | null;
  package_type?: string | null;
};

export type PackageExportResolution = {
  packageType: string;
  issue: string;
  inferred: boolean;
};

function normalizeCurrency(raw: unknown): Currency {
  return String(raw || '').trim().toUpperCase() === 'USD' ? 'USD' : 'COP';
}

function roundCurrency(amount: number, currency: Currency): number {
  return currency === 'COP'
    ? Math.round(amount)
    : Math.round(amount * 100) / 100;
}

function amountsMatch(a: number, b: number, currency: Currency): boolean {
  const tolerance = currency === 'COP' ? 1 : 0.01;
  return Math.abs(a - b) <= tolerance;
}

function finiteNumber(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function participantKey(participant: ParticipantPackageSource, index: number): string {
  return String(participant.id || `index:${index}`);
}

function initialResolution<T extends ParticipantPackageSource>(participants: T[]): Map<string, PackageExportResolution> {
  const map = new Map<string, PackageExportResolution>();
  participants.forEach((participant, index) => {
    map.set(participantKey(participant, index), {
      packageType: String(participant.package_type || '').trim(),
      issue: '',
      inferred: false,
    });
  });
  return map;
}

function expectedTotal<T extends ParticipantPackageSource>(
  participants: T[],
  currency: Currency,
  packageForParticipant: (participant: T) => PackageType,
): number {
  return participants.reduce((sum, participant) => sum + getPrice(currency, packageForParticipant(participant)), 0);
}

function setResolution<T extends ParticipantPackageSource>(
  resolved: Map<string, PackageExportResolution>,
  participants: T[],
  participant: T,
  value: PackageExportResolution,
): void {
  const index = participants.indexOf(participant);
  resolved.set(participantKey(participant, index >= 0 ? index : 0), value);
}

function candidateCorrection<T extends ParticipantPackageSource>(params: {
  candidates: T[];
  difference: number;
  priceDelta: number;
  currency: Currency;
}): { appliesToAllCandidates: boolean; suspectedCount: number } | null {
  if (!params.candidates.length || params.priceDelta <= 0) return null;
  const suspectedCount = Math.round(Math.abs(params.difference) / params.priceDelta);
  const adjustedDifference = params.difference < 0
    ? params.difference + (params.priceDelta * suspectedCount)
    : params.difference - (params.priceDelta * suspectedCount);
  if (
    suspectedCount <= 0
    || suspectedCount > params.candidates.length
    || !amountsMatch(adjustedDifference, 0, params.currency)
  ) {
    return null;
  }

  return {
    appliesToAllCandidates: suspectedCount === params.candidates.length,
    suspectedCount,
  };
}

export function resolveParticipantPackagesForExport<T extends ParticipantPackageSource>(
  booking: BookingPackageSource | null | undefined,
  participants: T[],
): Map<string, PackageExportResolution> {
  const resolved = initialResolution(participants);
  if (!participants.length) return resolved;

  const currency = normalizeCurrency(booking?.currency);
  const bookingTotal = finiteNumber(booking?.total_amount);
  if (bookingTotal === null) return resolved;

  const validParticipants = participants.filter((participant) => isValidPackageType(participant.package_type));
  if (validParticipants.length !== participants.length) {
    participants.forEach((participant, index) => {
      if (!isValidPackageType(participant.package_type)) {
        resolved.set(participantKey(participant, index), {
          packageType: String(participant.package_type || '').trim(),
          issue: 'PAQUETE_INVALIDO',
          inferred: false,
        });
      }
    });
    return resolved;
  }

  const originalTotal = roundCurrency(
    expectedTotal(participants, currency, (participant) => participant.package_type as PackageType),
    currency,
  );
  const difference = roundCurrency(bookingTotal - originalTotal, currency);
  if (amountsMatch(difference, 0, currency)) return resolved;

  const lodgingDelta = getPrice(currency, 'lodging') - getPrice(currency, 'no_lodging');
  const fromLodgingCandidates = participants.filter((participant) => participant.package_type === 'lodging');
  const fromNoLodgingCandidates = participants.filter((participant) => participant.package_type === 'no_lodging');

  if (difference < 0) {
    const correction = candidateCorrection({
      candidates: fromLodgingCandidates,
      difference,
      priceDelta: lodgingDelta,
      currency,
    });

    if (correction?.appliesToAllCandidates) {
      fromLodgingCandidates.forEach((participant) => {
        setResolution(resolved, participants, participant, {
          packageType: 'no_lodging',
          issue: 'CORREGIDO_EN_EXPORT_POR_TOTAL',
          inferred: true,
        });
      });
      return resolved;
    }

    if (correction) {
      fromLodgingCandidates.forEach((participant) => {
        setResolution(resolved, participants, participant, {
          packageType: 'lodging',
          issue: `REVISAR_TOTAL_SUGIERE_${correction.suspectedCount}_SIN_ALOJAMIENTO`,
          inferred: false,
        });
      });
      return resolved;
    }
  }

  if (difference > 0) {
    const correction = candidateCorrection({
      candidates: fromNoLodgingCandidates,
      difference,
      priceDelta: lodgingDelta,
      currency,
    });

    if (correction?.appliesToAllCandidates) {
      fromNoLodgingCandidates.forEach((participant) => {
        setResolution(resolved, participants, participant, {
          packageType: 'lodging',
          issue: 'CORREGIDO_EN_EXPORT_POR_TOTAL',
          inferred: true,
        });
      });
      return resolved;
    }

    if (correction) {
      fromNoLodgingCandidates.forEach((participant) => {
        setResolution(resolved, participants, participant, {
          packageType: 'no_lodging',
          issue: `REVISAR_TOTAL_SUGIERE_${correction.suspectedCount}_CON_ALOJAMIENTO`,
          inferred: false,
        });
      });
      return resolved;
    }
  }

  participants.forEach((participant, index) => {
    const key = participantKey(participant, index);
    const current = resolved.get(key);
    resolved.set(key, {
      packageType: current?.packageType ?? String(participant.package_type || '').trim(),
      issue: current?.issue || 'REVISAR_TOTAL_NO_CUADRA',
      inferred: current?.inferred ?? false,
    });
  });
  return resolved;
}
