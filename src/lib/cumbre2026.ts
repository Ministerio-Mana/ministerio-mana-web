import crypto from 'node:crypto';
import { sanitizePlainText, containsBlockedSequence } from './validation';

export type CountryGroup = 'CO' | 'INT';
export type Currency = 'COP' | 'USD';
export type PackageType = 'lodging' | 'no_lodging' | 'child_0_7' | 'child_7_13';

export const CUMBRE_PRICES_COP: Record<PackageType, number> = {
  lodging: 850000,
  no_lodging: 660000,
  child_0_7: 300000,
  child_7_13: 550000,
};

export const CUMBRE_PRICES_USD: Record<PackageType, number> = {
  lodging: 220,
  no_lodging: 170,
  child_0_7: 80,
  child_7_13: 140,
};

export interface ParticipantInput {
  fullName: string;
  packageType: PackageType;
  relationship?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
}

export interface SanitizedParticipant {
  fullName: string;
  packageType: PackageType;
  relationship: string | null;
  documentType: string | null;
  documentNumber: string | null;
}

export function normalizeCountryGroup(value: string | null | undefined): CountryGroup {
  const upper = (value || '').trim().toUpperCase();
  return upper === 'CO' || upper === 'COL' || upper === 'COLOMBIA' ? 'CO' : 'INT';
}

export function currencyForGroup(group: CountryGroup): Currency {
  return group === 'CO' ? 'COP' : 'USD';
}

export function isValidPackageType(value: string | null | undefined): value is PackageType {
  return value === 'lodging' || value === 'no_lodging' || value === 'child_0_7' || value === 'child_7_13';
}

export function sanitizeParticipant(input: ParticipantInput): SanitizedParticipant | null {
  if (containsBlockedSequence(input.fullName)) return null;
  const fullName = sanitizePlainText(input.fullName, 120);
  if (!fullName) return null;
  if (!isValidPackageType(input.packageType)) return null;
  const relationship = input.relationship ? sanitizePlainText(input.relationship, 80) : '';
  if (containsBlockedSequence(relationship)) return null;
  const documentType = input.documentType ? sanitizePlainText(input.documentType, 40) : '';
  const documentNumber = input.documentNumber ? sanitizePlainText(input.documentNumber, 50) : '';
  if (containsBlockedSequence(documentType) || containsBlockedSequence(documentNumber)) return null;
  return {
    fullName,
    packageType: input.packageType,
    relationship: relationship || null,
    documentType: documentType || null,
    documentNumber: documentNumber || null,
  };
}

export function getPrice(currency: Currency, packageType: PackageType): number {
  if (currency === 'COP') return CUMBRE_PRICES_COP[packageType];
  return CUMBRE_PRICES_USD[packageType];
}

export function calculateTotals(currency: Currency, participants: SanitizedParticipant[]): number {
  return participants.reduce((sum, participant) => sum + getPrice(currency, participant.packageType), 0);
}

export function depositThreshold(totalAmount: number): number {
  return Math.round(totalAmount * 0.5 * 100) / 100;
}

export type BookingStatus = 'PENDING' | 'DEPOSIT_OK' | 'PAID';

export function statusFromPaid(totalPaid: number, totalAmount: number): BookingStatus {
  if (totalPaid >= totalAmount && totalAmount > 0) return 'PAID';
  if (totalPaid >= depositThreshold(totalAmount) && totalAmount > 0) return 'DEPOSIT_OK';
  return 'PENDING';
}

const DEFAULT_REFERENCE_PREFIX = 'MM-EVT-CM26';

function getReferencePrefix(): string {
  const prefixRaw = process.env.CUMBRE_REFERENCE_PREFIX || DEFAULT_REFERENCE_PREFIX;
  const prefix = prefixRaw.replace(/[^A-Z0-9_-]/gi, '').toUpperCase() || DEFAULT_REFERENCE_PREFIX;
  return prefix;
}

function getReferencePrefixes(): string[] {
  const current = getReferencePrefix();
  const prefixes = new Set([current, DEFAULT_REFERENCE_PREFIX]);
  return Array.from(prefixes);
}

export function buildPaymentReference(bookingId: string, paymentIndex: number): string {
  const prefix = getReferencePrefix();
  const index = String(paymentIndex).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${bookingId}-P${index}-${rand}`;
}

export function buildInstallmentReference(params: {
  bookingId: string;
  planId: string;
  installmentIndex: number;
}): string {
  const prefix = getReferencePrefix();
  const index = String(params.installmentIndex).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${params.bookingId}-PLN-${params.planId}-P${index}-${rand}`;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateAccessToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

export function parseReferenceBookingId(reference: string | null | undefined): string | null {
  if (!reference) return null;
  for (const prefix of getReferencePrefixes()) {
    const match = reference.match(new RegExp(`${prefix}-([a-f0-9-]{8,})(?:-PLN-[a-f0-9-]{8,})?-P\\d{2}-`, 'i'));
    if (match) return match[1];
  }
  return null;
}

export function parseReferencePlanId(reference: string | null | undefined): string | null {
  if (!reference) return null;
  for (const prefix of getReferencePrefixes()) {
    const match = reference.match(new RegExp(`${prefix}-[a-f0-9-]{8,}-PLN-([a-f0-9-]{8,})-P\\d{2}-`, 'i'));
    if (match) return match[1];
  }
  return null;
}
