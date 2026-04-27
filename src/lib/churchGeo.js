const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const CONTINENT_ALIASES = {
  america: 'América',
  americas: 'América',
  europa: 'Europa',
  europe: 'Europa',
  asia: 'Asia',
  africa: 'África',
  oceania: 'Oceanía',
  australia: 'Oceanía',
};

const COUNTRY_TO_CONTINENT = {
  colombia: 'América',
  ecuador: 'América',
  mexico: 'América',
  'estados unidos': 'América',
  'united states': 'América',
  canada: 'América',
  panama: 'América',
  'costa rica': 'América',
  guatemala: 'América',
  honduras: 'América',
  nicaragua: 'América',
  'el salvador': 'América',
  belice: 'América',
  'centroamerica': 'América',
  centroamerica: 'América',
  brasil: 'América',
  argentina: 'América',
  peru: 'América',
  chile: 'América',
  bolivia: 'América',
  paraguay: 'América',
  uruguay: 'América',
  venezuela: 'América',
  francia: 'Europa',
  europa: 'Europa',
  espana: 'Europa',
  alemania: 'Europa',
  suiza: 'Europa',
  italia: 'Europa',
  portugal: 'Europa',
  'reino unido': 'Europa',
  'gran bretana': 'Europa',
  inglaterra: 'Europa',
  londres: 'Europa',
  australia: 'Oceanía',
  'nueva zelanda': 'Oceanía',
};

export const compareSpanishLabels = (a, b) =>
  String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });

export function resolveContinentForCountry(country) {
  const key = normalizeKey(country);
  if (!key) return 'América';
  return COUNTRY_TO_CONTINENT[key] || 'América';
}

export function normalizeChurchCountry(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed || 'Colombia';
  }
  const trimmed = String(input?.country || '').trim();
  return trimmed || 'Colombia';
}

export function normalizeChurchContinent(input, countryHint = '') {
  const raw = typeof input === 'string' ? input : input?.continent;
  const key = normalizeKey(raw);
  if (key && CONTINENT_ALIASES[key]) return CONTINENT_ALIASES[key];
  const country = countryHint || normalizeChurchCountry(input);
  return resolveContinentForCountry(country);
}

export function normalizeChurchCity(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed || 'Sin ciudad';
  }
  const trimmed = String(input?.city || '').trim();
  return trimmed || 'Sin ciudad';
}

export function enrichChurchGeo(church) {
  const country = normalizeChurchCountry(church);
  const continent = normalizeChurchContinent(church, country);
  const city = normalizeChurchCity(church);
  return {
    ...church,
    country,
    continent,
    city,
  };
}

export function buildChurchGeoTree(churches = []) {
  const normalizedChurches = (churches || []).map(enrichChurchGeo).sort((a, b) => {
    const continentCompare = compareSpanishLabels(a.continent, b.continent);
    if (continentCompare !== 0) return continentCompare;
    const countryCompare = compareSpanishLabels(a.country, b.country);
    if (countryCompare !== 0) return countryCompare;
    const cityCompare = compareSpanishLabels(a.city, b.city);
    if (cityCompare !== 0) return cityCompare;
    return compareSpanishLabels(a.name, b.name);
  });

  const continentMap = new Map();
  const countryMap = new Map();
  const cityMap = new Map();

  normalizedChurches.forEach((church) => {
    const continent = church.continent;
    const country = church.country;
    const city = church.city;

    continentMap.set(continent, (continentMap.get(continent) || 0) + 1);

    const countryKey = `${continent}||${country}`;
    const countryRecord = countryMap.get(countryKey) || { continent, country, count: 0 };
    countryRecord.count += 1;
    countryMap.set(countryKey, countryRecord);

    const cityKey = `${continent}||${country}||${city}`;
    const cityRecord = cityMap.get(cityKey) || { continent, country, city, count: 0 };
    cityRecord.count += 1;
    cityMap.set(cityKey, cityRecord);
  });

  const continentStats = Array.from(continentMap.entries())
    .map(([continent, count]) => ({ continent, count }))
    .sort((a, b) => compareSpanishLabels(a.continent, b.continent));

  const countryStats = Array.from(countryMap.values()).sort((a, b) => {
    const continentCompare = compareSpanishLabels(a.continent, b.continent);
    if (continentCompare !== 0) return continentCompare;
    return compareSpanishLabels(a.country, b.country);
  });

  const cityStats = Array.from(cityMap.values()).sort((a, b) => {
    const continentCompare = compareSpanishLabels(a.continent, b.continent);
    if (continentCompare !== 0) return continentCompare;
    const countryCompare = compareSpanishLabels(a.country, b.country);
    if (countryCompare !== 0) return countryCompare;
    return compareSpanishLabels(a.city, b.city);
  });

  const countriesByContinent = countryStats.reduce((acc, entry) => {
    if (!acc[entry.continent]) acc[entry.continent] = [];
    acc[entry.continent].push(entry);
    return acc;
  }, {});

  const citiesByCountry = cityStats.reduce((acc, entry) => {
    const key = `${entry.continent}||${entry.country}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  const continentByCountry = countryStats.reduce((acc, entry) => {
    acc[entry.country] = entry.continent;
    return acc;
  }, {});

  return {
    churches: normalizedChurches,
    continents: continentStats.map((entry) => entry.continent),
    continentStats,
    countryStats,
    cityStats,
    countriesByContinent,
    citiesByCountry,
    continentByCountry,
  };
}
