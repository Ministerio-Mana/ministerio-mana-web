export const CUMBRE_GALLERY_SLUG = 'cumbre-mundial-2026';
export const CUMBRE_GALLERY_FOLDER = CUMBRE_GALLERY_SLUG;

export const CUMBRE_GALLERY_ALBUMS = [
  { slug: 'generales', title: 'Momentos generales', description: 'Encuentros, plenarias y vida compartida durante la Cumbre.' },
  { slug: 'noche-de-las-naciones', title: 'Noche de las Naciones', description: 'Una celebración de la iglesia y las naciones representadas.' },
  { slug: 'mujeres', title: 'Mujeres', description: 'Momentos del encuentro y ministerio de mujeres.' },
  { slug: 'campus', title: 'Campus', description: 'La participación de jóvenes y misioneros universitarios.' },
  { slug: 'toldos', title: 'Toldos', description: 'Comunidad, conversaciones y actividades fuera del auditorio.' },
  { slug: 'obra-de-teatro', title: 'Obra de teatro', description: 'Presentación artística de la Cumbre Mundial Maná.' },
  { slug: 'varones', title: 'Varones', description: 'Encuentro y formación de varones.' },
  { slug: 'pastores', title: 'Pastores', description: 'Pastores y líderes sirviendo juntos.' },
  { slug: 'peticiones-bautizos-santa-cena-y-piedras', title: 'Celebraciones de fe', description: 'Peticiones, bautizos, Santa Cena y piedras de memoria.' },
] as const;

export type CumbreGalleryAlbumSlug = typeof CUMBRE_GALLERY_ALBUMS[number]['slug'];

export function isCumbreGalleryAlbum(value: string): value is CumbreGalleryAlbumSlug {
  return CUMBRE_GALLERY_ALBUMS.some((album) => album.slug === value);
}

export function cumbreGalleryFolder(album: CumbreGalleryAlbumSlug): string {
  return `${CUMBRE_GALLERY_FOLDER}/${album}`;
}
