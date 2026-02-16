-- Seed incremental de iglesias para mapa/directorio + selector del portal
-- Ejecutar despues de: docs/sql/portal_iglesias.sql y docs/sql/update_churches_schema.sql

alter table public.churches
  add column if not exists code text,
  add column if not exists address text,
  add column if not exists maps_url text,
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

create unique index if not exists churches_code_unique
  on public.churches(code);

insert into public.churches (
  code,
  name,
  city,
  country,
  address,
  maps_url,
  lat,
  lng,
  contact_name,
  contact_email,
  contact_phone
)
values
  (
    'colombia-pereira-iglesia-mana-pereira',
    'Iglesia Maná Pereira',
    'Pereira',
    'Colombia',
    'Calle 22 #5-45',
    'https://maps.google.com/?q=Calle+22+%235-45+Pereira+Colombia',
    4.8143,
    -75.6946,
    'Ps. Edwin Andrés Grijalba Mora',
    'iglesiapereira@ministeriomana.org',
    '+57 316 4280558'
  ),
  (
    'ecuador-cuenca-mana-ecuador-cuenca',
    'Maná Ecuador · Cuenca',
    'Cuenca',
    'Ecuador',
    'Calle Benigno Vasquez y Av 25 de Marzo, al costado de los bomberos, Ricaurte (Iglesia Pueblo Especial)',
    'https://maps.google.com/?q=Calle+Benigno+Vasquez+y+Av+25+de+Marzo+Ricaurte+Cuenca',
    -2.8856,
    -78.9721,
    'Ps. Luis Pando',
    null,
    '+593 992098343'
  ),
  (
    'ecuador-quito-mana-ecuador-quito',
    'Maná Ecuador · Quito',
    'Quito',
    'Ecuador',
    'Luxemburgo N34-150 y Holanda, Edificio Piacevole',
    'https://maps.google.com/?q=Luxemburgo+N34-150+y+Holanda+Quito',
    -0.1806,
    -78.4844,
    'Ps. Luis Niño',
    null,
    '+593 993312750'
  ),
  (
    'ecuador-guayaquil-sur-mana-ecuador-guayaquil-sur',
    'Maná Ecuador · Guayaquil Sur',
    'Guayaquil (Sur)',
    'Ecuador',
    'Av. La Saiba y Bogotá (esquina), Cdla. La Saiba',
    'https://maps.google.com/?q=Av+La+Saiba+y+Bogota+Guayaquil',
    -2.2163,
    -79.8988,
    'Ps. Luis Niño',
    null,
    '+593 993312750'
  ),
  (
    'ecuador-guayaquil-norte-mana-ecuador-guayaquil-norte',
    'Maná Ecuador · Guayaquil Norte',
    'Guayaquil (Norte)',
    'Ecuador',
    'Circunvalación Sur 725 y Guayacanes (esquina), Sector Urdesa Central',
    'https://maps.google.com/?q=Circunvalacion+Sur+725+y+Guayacanes+Guayaquil',
    -2.172,
    -79.9126,
    'Ls. Christian Landivar',
    null,
    '+593 961778888'
  ),
  (
    'mexico-tantoyuca-veracruz-mana-mexico-emanuel-cielos-abiertos',
    'Maná México · Emanuel Cielos Abiertos',
    'Tantoyuca, Veracruz',
    'México',
    'Naucalpan esq. con Acolman S/N, Colonia Guadalupe Victoria, Tantoyuca, Veracruz',
    'https://maps.google.com/?q=Naucalpan+con+Acolman+Tantoyuca+Veracruz',
    21.3542,
    -98.2255,
    'Ps. Emanuel',
    null,
    '+52 789 1094998'
  ),
  (
    'francia-paris-mana-francia-paris',
    'Maná Francia · París',
    'París',
    'Francia',
    '3 rue de la Pierre L''evée, 75011 Paris',
    'https://maps.google.com/?q=3+rue+de+la+Pierre+L%27evee+75011+Paris',
    48.8663,
    2.3703,
    'Carlos Claros',
    'carlosclaros@ministeriomana.org',
    '+33 6 66 54 83 05'
  ),
  (
    'europa-europa-virtual-mana-europa-contacto-regional',
    'Maná Europa · Contacto Regional',
    'Europa (Virtual)',
    'Europa',
    'Conexión virtual coordinada desde París',
    null,
    48.8566,
    2.3522,
    'Carlos Claros',
    'carlosclaros@ministeriomana.org',
    '+33 6 66 54 83 05'
  )
on conflict (code)
do update set
  name = excluded.name,
  city = excluded.city,
  country = excluded.country,
  address = excluded.address,
  maps_url = excluded.maps_url,
  lat = excluded.lat,
  lng = excluded.lng,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  updated_at = now();
