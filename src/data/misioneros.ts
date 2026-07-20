
export type Misionero = {
  slug: string;
  nombre: string;
  rol?: string;
  video?: string;
  foto?: string;
  wompiLink?: string;
  stripePriceId?: string;
  pushpayUrl?: string;
};
export const MISIONEROS: Misionero[] = [
  { slug: 'ariel-guzman', nombre: 'Ariel Guzmán', rol: 'Misionero Campus', foto: '/images/campus/misioneros/ariel-guzman.jpg', video: 'https://www.youtube.com/embed/VIDEO_ID_ARIEL', wompiLink: '#', stripePriceId: 'price_ariel', pushpayUrl: 'https://ppay.co/3Zvh5mQk2bI' },
  { slug: 'amaury-padilla', nombre: 'Amaury Padilla', rol: 'Misionero Campus', foto: '/images/campus/misioneros/amaury-padilla.jpg', video: 'https://www.youtube.com/embed/VIDEO_ID_AMAURY', wompiLink: '#', stripePriceId: 'price_amaury', pushpayUrl: 'https://ppay.co/kTQL9jo0ulA' },
  { slug: 'leidy-gaviria', nombre: 'Leidy Gaviria', rol: 'Misionera Campus', foto: '/images/campus/misioneros/leidy-gaviria.jpg', video: 'https://www.youtube.com/embed/VIDEO_ID_LEIDY', wompiLink: '#', stripePriceId: 'price_leidy', pushpayUrl: 'https://ppay.co/ArPBqCx0Ras' },
  { slug: 'rocio-nino', nombre: 'Rocío Niño', rol: 'Misionera Campus', foto: '/images/campus/misioneros/rocio-nino.jpg', video: 'https://www.youtube.com/embed/VIDEO_ID_ROCIO', wompiLink: '#', stripePriceId: 'price_rocio', pushpayUrl: 'https://ppay.co/9l7CieVtH4M' },
  { slug: 'maria-camila-rios', nombre: 'María Camila Ríos', rol: 'Misionera Campus', foto: '/images/campus/misioneros/maria-camila-rios.jpg', video: 'https://www.youtube.com/embed/VIDEO_ID_MARIA', wompiLink: '#', stripePriceId: 'price_maria-camila', pushpayUrl: 'https://ppay.co/IdG9WhlsxDs' },
  { slug: 'oscar-hernandez', nombre: 'ÓSCAR HERNÁNDEZ', rol: 'Misionero Campus', foto: '/images/campus/misioneros/oscar-hernandez.jpg', video: 'https://www.youtube.com/embed/VIDEO_ID_OSCAR', wompiLink: '#', stripePriceId: 'price_oscar', pushpayUrl: 'https://ppay.co/XbQ7em0s1sA' }
];
