export type MinistryKey = 'campus' | 'varones' | 'ninos' | 'mujeres' | 'mana';
export type RoutedMinistryKey = Exclude<MinistryKey, 'campus'>;

export type MinistryConfig = {
  key: MinistryKey;
  name: string;
  shortName: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  body: string;
  cta: string;
  href: string;
  accent: string;
  glow: string;
  actions: string[];
  pillars: { title: string; text: string }[];
  external?: boolean;
};

export const ministryOrder: MinistryKey[] = ['campus', 'mujeres', 'ninos', 'varones', 'mana'];
export const routedMinistryKeys: RoutedMinistryKey[] = ['varones', 'ninos', 'mujeres', 'mana'];

export const ministries: Record<MinistryKey, MinistryConfig> = {
  campus: {
    key: 'campus',
    name: 'Campus Maná',
    shortName: 'Campus',
    eyebrow: 'Socios de la Gran Comisión',
    headline: 'Ayuda a alcanzar universidades',
    subheadline: 'La landing de Campus ya está lista para apadrinar misioneros y sembrar en la obra universitaria.',
    body: 'Campus Maná se mantiene en su experiencia actual: misioneros, visión universitaria y pasos claros para apoyar. Desde esta campaña lo conectamos como una respuesta concreta al llamado.',
    cta: 'Ir a Campus Maná',
    href: '/ven-ayudanos/campus',
    accent: '#2DD4BF',
    glow: 'rgba(45, 212, 191, 0.24)',
    actions: ['Apadrinar misioneros', 'Orar por universidades', 'Abrir puertas', 'Acompañar estudiantes'],
    pillars: [
      { title: 'Universidades', text: 'Llevar el evangelio donde se forman generaciones.' },
      { title: 'Misioneros', text: 'Sostener a quienes sirven en el campo universitario.' },
      { title: 'Discipulado', text: 'Acompañar estudiantes con Palabra, comunidad y propósito.' },
      { title: 'Puertas abiertas', text: 'Conectar contactos, espacios y oportunidades reales.' },
    ],
    external: true,
  },
  mujeres: {
    key: 'mujeres',
    name: 'Mujeres',
    shortName: 'Mujeres',
    eyebrow: 'Feminidad con diseño divino',
    headline: 'Mujeres que sostienen el llamado',
    subheadline: 'Una red de mujeres que creen profundamente, sirven con amor y dejan legado.',
    body: 'Creemos en mujeres que sostienen estructura, levantan a otras con gracia, sirven con sabiduría y forman comunidad alrededor de la Palabra.',
    cta: 'Quiero ayudar en Mujeres',
    href: '/ven-ayudanos/mujeres',
    accent: '#AC569B',
    glow: 'rgba(206, 134, 185, 0.28)',
    actions: ['Acompañar', 'Crear recursos', 'Servir en campañas', 'Compartir testimonio'],
    pillars: [
      { title: 'Identidad', text: 'Afirmadas en Cristo.' },
      { title: 'Palabra', text: 'Formadas en la verdad.' },
      { title: 'Comunión', text: 'Caminando juntas.' },
      { title: 'Propósito', text: 'Edificando la casa de Dios.' },
    ],
  },
  ninos: {
    key: 'ninos',
    name: 'Maná Kids',
    shortName: 'Kids',
    eyebrow: 'Próxima generación',
    headline: 'Ayuda a que los niños conozcan la Palabra',
    subheadline: 'Sirve, enseña, crea materiales, aporta ideas y ayuda a que los niños conozcan a Jesús.',
    body: 'Cada niño necesita crecer en la Palabra y ser acompañado con amor. La ayuda puede verse como ilustración, guiones, animación, enseñanza, materiales, manualidades, música, servicio y oración.',
    cta: 'Quiero ayudar en Maná Kids',
    href: '/ven-ayudanos/ninos',
    accent: '#00A7BD',
    glow: 'rgba(0, 167, 189, 0.23)',
    actions: ['Ilustrar', 'Animar', 'Crear guiones', 'Enseñar', 'Manualidades', 'Materiales'],
    pillars: [
      { title: 'Fe', text: 'Niños conociendo a Jesús desde temprano.' },
      { title: 'Palabra', text: 'Recursos sencillos, bíblicos y memorables.' },
      { title: 'Familias', text: 'Padres acompañados en la formación espiritual.' },
      { title: 'Servicio', text: 'Equipos preparados para cuidar y enseñar.' },
    ],
  },
  varones: {
    key: 'varones',
    name: 'Varones',
    shortName: 'Varones',
    eyebrow: 'Formación y discipulado',
    headline: 'Hombres formados para formar',
    subheadline: 'Ayuda a levantar varones firmes en la Palabra, responsables y dispuestos a discipular.',
    body: 'La iglesia necesita varones bíblicos, responsables y presentes. Puedes ayudar formándote, liderando grupos, acompañando a otros hombres, sirviendo en encuentros o creando recursos.',
    cta: 'Quiero ayudar en Varones',
    href: '/ven-ayudanos/varones',
    accent: '#38BDF8',
    glow: 'rgba(56, 189, 248, 0.24)',
    actions: ['Formarme', 'Liderar grupos', 'Acompañar varones', 'Servir en encuentros'],
    pillars: [
      { title: 'Palabra', text: 'Hombres firmes en fundamentos bíblicos.' },
      { title: 'Responsabilidad', text: 'Carácter probado en casa, iglesia y trabajo.' },
      { title: 'Discipulado', text: 'Varones que forman a otros con humildad.' },
      { title: 'Servicio', text: 'Manos listas para edificar y sostener.' },
    ],
  },
  mana: {
    key: 'mana',
    name: 'Ministerio Maná',
    shortName: 'Maná',
    eyebrow: 'La casa que envía',
    headline: 'Sostén la casa que envía',
    subheadline: 'Pon tus dones, ideas, tiempo y recursos al servicio de la obra.',
    body: 'Detrás de cada ministerio hay comunicación, producción, logística, tecnología, administración, oración y muchas manos sirviendo. Si quieres ayudar donde más se necesite, este es tu lugar.',
    cta: 'Quiero ayudar al Ministerio Maná',
    href: '/ven-ayudanos/mana',
    accent: '#F2C94C',
    glow: 'rgba(242, 201, 76, 0.25)',
    actions: ['Comunicación', 'Producción', 'Tecnología', 'Logística', 'Ideas', 'Generosidad'],
    pillars: [
      { title: 'Comunicación', text: 'Historias, diseño, fotografía, video y redes.' },
      { title: 'Producción', text: 'Apoyo para eventos, reuniones y campañas.' },
      { title: 'Tecnología', text: 'Herramientas que sirven a la misión.' },
      { title: 'Generosidad', text: 'Recursos que abren camino para la obra.' },
    ],
  },
};

export const helpOptions = [
  {
    key: 'tiempo',
    label: 'Tiempo',
    text: 'Sirve en eventos, reuniones, campañas, grupos o equipos de apoyo.',
  },
  {
    key: 'talentos',
    label: 'Talentos',
    text: 'Diseño, música, producción, enseñanza, comunicaciones, fotografía, video, tecnología o administración.',
  },
  {
    key: 'ideas',
    label: 'Ideas',
    text: 'Propón proyectos, campañas, recursos, conexiones o soluciones para fortalecer el ministerio.',
  },
  {
    key: 'servicio',
    label: 'Servicio',
    text: 'Acompaña personas, recibe nuevos, organiza espacios o apoya equipos.',
  },
  {
    key: 'oracion',
    label: 'Oración',
    text: 'Intercede por ministerios, líderes, universidades, familias, niños y nuevos creyentes.',
  },
  {
    key: 'generosidad',
    label: 'Generosidad',
    text: 'Apoya económicamente una misión, un recurso, un evento o un misionero.',
  },
  {
    key: 'apadrinamiento',
    label: 'Apadrinamiento',
    text: 'Sostén de manera recurrente a quienes dedican su vida al ministerio.',
  },
  {
    key: 'difusion',
    label: 'Difusión',
    text: 'Comparte el ministerio, invita a otros, abre puertas y conecta personas.',
  },
] as const;
