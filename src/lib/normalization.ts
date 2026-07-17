import { sanitizePlainText } from './validation.ts';

const CITY_ALIASES: Record<string, string> = {
  cali: 'Cali',
  medellin: 'Medellín',
  bogota: 'Bogotá',
  barranquilla: 'Barranquilla',
  bucaramanga: 'Bucaramanga',
  cartagena: 'Cartagena',
  pereira: 'Pereira',
  manizales: 'Manizales',
  ibague: 'Ibagué',
  pasto: 'Pasto',
  armenia: 'Armenia',
  monteria: 'Montería',
  cucuta: 'Cúcuta',
  neiva: 'Neiva',
  villavicencio: 'Villavicencio',
  'santa marta': 'Santa Marta',
  sincelejo: 'Sincelejo',
  tunja: 'Tunja',
  riohacha: 'Riohacha',
  valledupar: 'Valledupar',
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
    .trim();
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const COUNTRY_REGION_ALIASES: Record<string, string> = {
  usa: 'Estados Unidos',
  us: 'Estados Unidos',
  unitedstates: 'Estados Unidos',
  unitedstatesofamerica: 'Estados Unidos',
  estadosunidos: 'Estados Unidos',
  estadosunidosdeamerica: 'Estados Unidos',
  eeuu: 'Estados Unidos',
  eua: 'Estados Unidos',
  centroamerica: 'Centroamérica',
  centralamerica: 'Centroamérica',
  europa: 'Europa',
  europe: 'Europa',
  australia: 'Australia',
};

export function normalizeCityName(value: string | null | undefined): string {
  const cleaned = sanitizePlainText(value ?? '', 80);
  if (!cleaned) return '';
  const normalized = stripAccents(cleaned).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return '';
  const alias = CITY_ALIASES[normalized] ?? normalized;
  return titleCase(alias);
}

export function normalizeCountryRegion(value: string | null | undefined): string {
  const cleaned = sanitizePlainText(value ?? '', 80);
  if (!cleaned) return '';
  const key = stripAccents(cleaned).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return cleaned;
  return COUNTRY_REGION_ALIASES[key] || titleCase(cleaned);
}

export function normalizeChurchName(value: string | null | undefined): string {
  const cleaned = sanitizePlainText(value ?? '', 120);
  if (!cleaned) return '';
  const compact = cleaned.replace(/\s+/g, ' ').trim();
  if (!compact) return '';

  const stopwords = new Set([
    'iglesia',
    'iglesias',
    'mana',
    'maná',
    'ministerio',
    'sede',
    'sedes',
  ]);

  const normalizedTokens = stripAccents(compact)
    .toLowerCase()
    .split(' ')
    .filter((token) => token && !stopwords.has(token));

  const core = normalizedTokens.join(' ').trim();
  if (!core) return '';

  if (CITY_ALIASES[core]) {
    return CITY_ALIASES[core];
  }

  const parts = core.split(' ');
  const result: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const pair = i < parts.length - 1 ? `${parts[i]} ${parts[i + 1]}` : null;
    if (pair && CITY_ALIASES[pair]) {
      result.push(CITY_ALIASES[pair]);
      i += 1;
      continue;
    }
    if (CITY_ALIASES[parts[i]]) {
      result.push(CITY_ALIASES[parts[i]]);
      continue;
    }
    result.push(titleCase(parts[i]));
  }

  return result.join(' ').trim();
}
