
export type Misionero = {
  slug: string;
  nombre: string;
  rol?: string;
  video?: string;
  foto?: string;
  wompiLink?: string;
  stripePriceId?: string;
};
export const MISIONEROS: Misionero[] = [
  { slug: 'ariel-guzman', nombre: 'Ariel Guzmán', rol: 'Misionero Campus', video: 'https://www.youtube.com/embed/VIDEO_ID_ARIEL', wompiLink: '#', stripePriceId: 'price_ariel' },
  { slug: 'amaury-padilla', nombre: 'Amaury Padilla', rol: 'Misionero Campus', video: 'https://www.youtube.com/embed/VIDEO_ID_AMAURY', wompiLink: '#', stripePriceId: 'price_amaury' },
  { slug: 'leidy-gaviria', nombre: 'Leidy Gaviria', rol: 'Misionera Campus', video: 'https://www.youtube.com/embed/VIDEO_ID_LEIDY', wompiLink: '#', stripePriceId: 'price_leidy' },
  { slug: 'rocio-nino', nombre: 'Rocío Niño', rol: 'Misionera Campus', video: 'https://www.youtube.com/embed/VIDEO_ID_ROCIO', wompiLink: '#', stripePriceId: 'price_rocio' },
  { slug: 'maria-camila-rios', nombre: 'María Camila Ríos', rol: 'Misionera Campus', video: 'https://www.youtube.com/embed/VIDEO_ID_MARIA', wompiLink: '#', stripePriceId: 'price_maria-camila' }
];
