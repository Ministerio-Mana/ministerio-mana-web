import type { PortalChurchAccessContext } from './portalAccess.ts';
import { normalizeCountryRegion } from './normalization.ts';
import { canCreateChurchDirectory, canEditChurchDirectory } from './portalRbac.ts';

export const CHURCH_KINDS = ['CHURCH', 'GROUP'] as const;
export const CHURCH_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;

export type ChurchKind = (typeof CHURCH_KINDS)[number];
export type ChurchStatus = (typeof CHURCH_STATUSES)[number];

export type ChurchManagementInput = {
  name: string;
  kind: ChurchKind;
  status: ChurchStatus;
  country: string;
  region_id: string | null;
  city: string;
  address: string;
  maps_url: string;
  lat: number | null;
  lng: number | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  service: string;
  notes: string;
  is_public: boolean;
  show_on_map: boolean;
};

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function cleanMultiline(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().replace(/\r\n?/g, '\n').slice(0, maxLength);
}

function cleanPhone(value: unknown): string {
  return String(value ?? '').trim().replace(/[^0-9+()\-\s]/g, '').slice(0, 32);
}

function cleanEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().slice(0, 254);
}

function safeHttpUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString().slice(0, 1200) : '';
  } catch {
    return '';
  }
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

export function hasValidChurchCoordinates(lat: unknown, lng: unknown): boolean {
  return coordinate(lat, -90, 90) !== null && coordinate(lng, -180, 180) !== null;
}

export function canCreateChurch(access: Pick<PortalChurchAccessContext, 'role' | 'isPasswordSession'>): boolean {
  return !access.isPasswordSession && canCreateChurchDirectory(access.role);
}

export function canEditChurch(access: Pick<PortalChurchAccessContext, 'role' | 'isPasswordSession'>): boolean {
  return !access.isPasswordSession && canEditChurchDirectory(access.role);
}

export function normalizeChurchManagementInput(raw: Record<string, unknown>): ChurchManagementInput {
  const status = String(raw.status || 'DRAFT').toUpperCase();
  const kind = String(raw.kind || 'CHURCH').toUpperCase();
  const isPublic = Boolean(raw.is_public);
  const lat = coordinate(raw.lat, -90, 90);
  const lng = coordinate(raw.lng, -180, 180);
  return {
    name: cleanText(raw.name, 160),
    kind: CHURCH_KINDS.includes(kind as ChurchKind) ? kind as ChurchKind : 'CHURCH',
    status: CHURCH_STATUSES.includes(status as ChurchStatus) ? status as ChurchStatus : 'DRAFT',
    country: normalizeCountryRegion(cleanText(raw.country, 100)),
    region_id: cleanText(raw.region_id, 80) || null,
    city: cleanText(raw.city, 120),
    address: cleanText(raw.address, 320),
    maps_url: safeHttpUrl(raw.maps_url),
    lat,
    lng,
    contact_name: cleanText(raw.contact_name, 160),
    contact_email: cleanEmail(raw.contact_email),
    contact_phone: cleanPhone(raw.contact_phone),
    service: cleanMultiline(raw.service, 600),
    notes: cleanMultiline(raw.notes, 900),
    is_public: isPublic,
    show_on_map: isPublic && Boolean(raw.show_on_map) && lat !== null && lng !== null,
  };
}

export function validateChurchManagementInput(input: ChurchManagementInput): string[] {
  const errors: string[] = [];
  if (input.name.length < 3) errors.push('Escribe un nombre de al menos 3 caracteres.');
  if (!input.country) errors.push('Selecciona el país.');
  if (!input.city) errors.push('Escribe la ciudad o municipio.');
  if (input.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact_email)) {
    errors.push('Revisa el correo de contacto.');
  }
  if (input.is_public && !input.address && !input.maps_url) {
    errors.push('Para publicar en el directorio agrega una dirección o un enlace de ubicación.');
  }
  if (input.show_on_map && (input.lat === null || input.lng === null)) {
    errors.push('Para mostrar un pin en el mapa confirma la ubicación exacta.');
  }
  return errors;
}

export function normalizeChurchCode(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function extractCoordinatesFromMapsUrl(value: string): { lat: number; lng: number } | null {
  const raw = String(value || '').trim();
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:query|q)=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const lat = coordinate(match[1], -90, 90);
    const lng = coordinate(match[2], -180, 180);
    if (lat !== null && lng !== null) return { lat, lng };
  }
  return null;
}
