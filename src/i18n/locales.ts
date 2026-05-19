
export const LOCALES = ['es','en'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'es';
export const messages: Record<Locale, Record<string,string>> = {
  es: {
    nav_home: 'Inicio',
    nav_ministry: 'Ministerio',
    nav_campus: 'Campus Maná',
    nav_school: 'Escuela Bíblica',
    nav_churches: 'Iglesias',
    nav_events: 'Eventos',
    nav_devotional: 'Devocional',
    nav_women: 'Mujeres',
    nav_pilgrims: 'Peregrinaciones',
    nav_donate: 'Donar',
    donate: 'Donar',
    see_more: 'Ver más',
    home_community_text: 'Caminamos juntos como una familia de iglesias, campus y grupos que comparten fe, esperanza y la Palabra de Dios.',
    footer_devotional_script: 'Escucha',
    footer_devotional_outline: 'Devocional',
    footer_devotional_solid: 'Maná',
    footer_devotional_text: 'Palabra diaria para volver a Dios durante el día, sin salir de la página.',
    footer_join: 'Recibir por WhatsApp',
    footer_youtube_channel: 'Ver canal de YouTube',
    footer_player_aria: 'Reproductor del Devocional Maná',
    footer_player_source: 'Audio vía YouTube',
    footer_player_title_fallback: 'Devocional Maná',
    footer_playlist_label: 'Devocionales',
    footer_player_iframe_title: 'Playlist de Devocional Maná en YouTube',
    footer_player_body_fallback: 'Reproduce el devocional más reciente y continúa navegando por el sitio.',
    footer_player_play: 'Reproducir',
    footer_player_pause: 'Pausar',
    footer_player_previous: 'Anterior',
    footer_player_next: 'Siguiente',
    footer_explore: 'Explora',
    footer_all_campus: 'Todos los Campus',
    footer_church_network: 'Red de Iglesias',
    footer_participate: 'Participa',
    footer_events_agenda: 'Agenda de Eventos',
    footer_contact: 'Contáctanos',
    footer_rights: 'Todos los derechos reservados.',
    footer_privacy: 'Política de Privacidad',
    footer_terms: 'Términos de Uso'
  },
  en: {
    nav_home: 'Home',
    nav_ministry: 'Ministry',
    nav_campus: 'Campus Maná',
    nav_school: 'Bible School',
    nav_churches: 'Churches',
    nav_events: 'Events',
    nav_devotional: 'Devotional',
    nav_women: 'Women',
    nav_pilgrims: 'Pilgrimages',
    nav_donate: 'Donate',
    donate: 'Donate',
    see_more: 'See more',
    home_community_text: 'We walk together as a family of churches, campuses, and groups sharing faith, hope, and the Word of God.',
    footer_devotional_script: 'Listen',
    footer_devotional_outline: 'Devotional',
    footer_devotional_solid: 'Maná',
    footer_devotional_text: 'A daily word to return to God throughout the day without leaving the page.',
    footer_join: 'Receive on WhatsApp',
    footer_youtube_channel: 'View YouTube channel',
    footer_player_aria: 'Maná Devotional player',
    footer_player_source: 'Audio via YouTube',
    footer_player_title_fallback: 'Maná Devotional',
    footer_playlist_label: 'Devotionals',
    footer_player_iframe_title: 'Maná Devotional YouTube playlist',
    footer_player_body_fallback: 'Play the latest devotional and keep browsing the site.',
    footer_player_play: 'Play',
    footer_player_pause: 'Pause',
    footer_player_previous: 'Previous',
    footer_player_next: 'Next',
    footer_explore: 'Explore',
    footer_all_campus: 'All Campuses',
    footer_church_network: 'Church Network',
    footer_participate: 'Participate',
    footer_events_agenda: 'Events Calendar',
    footer_contact: 'Contact us',
    footer_rights: 'All rights reserved.',
    footer_privacy: 'Privacy Policy',
    footer_terms: 'Terms of Use'
  }
};

export function normalizeLocale(value: unknown): Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

export function t(locale: Locale, key: string, fallback?: string) {
  return messages[locale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? fallback ?? key;
}
