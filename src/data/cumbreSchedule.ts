export type CumbreAudience =
  | 'todos'
  | 'ninos'
  | 'mujeres'
  | 'varones'
  | 'campus'
  | 'pastoral'
  | 'logistica';

export type CumbreEventStatus = 'confirmed' | 'pending' | 'internal';

export interface CumbreScheduleEvent {
  id: string;
  date: '2026-06-06' | '2026-06-07' | '2026-06-08';
  day: 'Sábado' | 'Domingo' | 'Lunes';
  startsAt: string;
  endsAt: string;
  title: string;
  description: string;
  audience: CumbreAudience;
  trackLabel: string;
  speaker?: string;
  responsible?: string;
  delegation?: string;
  location?: string;
  teamNotes?: string;
  status?: CumbreEventStatus;
  public?: boolean;
}

export interface CumbreDay {
  date: CumbreScheduleEvent['date'];
  label: string;
  shortLabel: string;
  title: string;
  summary: string;
}

export interface CumbreFilter {
  id: CumbreAudience | 'all';
  label: string;
}

export interface DelegationAssignment {
  area: string;
  responsible: string;
  detail?: string;
}

export interface TestimonyAssignment {
  moment: string;
  speaker: string;
  theme: string;
  delegations?: string;
}

const eventLocation = 'Casa de Encuentros La Salle, Rionegro, Antioquia';
const bogotaUtcOffsetHours = 5;

export const cumbreDays: CumbreDay[] = [
  {
    date: '2026-06-06',
    label: 'Sábado 6 de junio',
    shortLabel: 'Sab 6',
    title: 'Bienvenida y comunión',
    summary: 'Recepción, palabra, presentación de delegaciones y tarde familiar.',
  },
  {
    date: '2026-06-07',
    label: 'Domingo 7 de junio',
    shortLabel: 'Dom 7',
    title: 'Palabra, talleres y naciones',
    summary: 'Devocional, enseñanzas, encuentros por ministerio y noche de las naciones.',
  },
  {
    date: '2026-06-08',
    label: 'Lunes 8 de junio',
    shortLabel: 'Lun 8',
    title: 'Envío y clausura',
    summary: 'Devocional, nueva generación, clausura, consagración y almuerzo final.',
  },
];

export const cumbreAudienceFilters: CumbreFilter[] = [
  { id: 'all', label: 'Todos' },
  { id: 'todos', label: 'General' },
  { id: 'ninos', label: 'Niños' },
  { id: 'mujeres', label: 'Mujeres' },
  { id: 'varones', label: 'Varones' },
  { id: 'campus', label: 'Campus' },
];

export const cumbreTeamFilters: CumbreFilter[] = [
  ...cumbreAudienceFilters,
  { id: 'pastoral', label: 'Equipo pastoral' },
  { id: 'logistica', label: 'Logística' },
];

export const cumbreScheduleEvents: CumbreScheduleEvent[] = [
  {
    id: 'sabado-recepcion',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '07:00',
    endsAt: '08:00',
    title: 'Mesa de recepción',
    description: 'Llegada, verificación de asistencia y orientación inicial.',
    audience: 'todos',
    trackLabel: 'General',
    responsible: 'Julian',
    location: eventLocation,
  },
  {
    id: 'sabado-desayuno',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '08:00',
    endsAt: '10:00',
    title: 'Desayuno',
    description: 'Primer espacio de comunión y preparación para la jornada.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'sabado-alabanza',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '10:00',
    endsAt: '10:45',
    title: 'Alabanza',
    description: 'Apertura de adoración con toda la familia Maná.',
    audience: 'todos',
    trackLabel: 'General',
    responsible: 'Mateo Ríos - Paris',
    location: eventLocation,
  },
  {
    id: 'sabado-ninos-bienvenida',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '10:00',
    endsAt: '12:00',
    title: 'Bienvenida ministerio infantil',
    description: 'Actividad de bienvenida, equipos y devociones personales.',
    audience: 'ninos',
    trackLabel: 'Niños',
    responsible: 'Edwin, Cate y Aura',
    location: eventLocation,
  },
  {
    id: 'sabado-delegaciones',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '10:45',
    endsAt: '11:05',
    title: 'Presentación de delegaciones',
    description: 'Reconocimiento de las sedes, equipos y familias que llegan a la Cumbre.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'sabado-poder-evangelio',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '11:05',
    endsAt: '11:45',
    title: 'El poder del evangelio',
    description: 'La visión de las barcas y el llamado a responder juntos.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Carlos Ríos',
    delegation: 'Campus',
    location: eventLocation,
    teamNotes: 'Incluye interpretación de las barcas con Campus.',
  },
  {
    id: 'sabado-programa',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '11:45',
    endsAt: '12:00',
    title: 'Presentación del programa',
    description: 'Orientación general de la Cumbre, rutas y momentos clave.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'sabado-almuerzo',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '12:00',
    endsAt: '14:00',
    title: 'Almuerzo',
    description: 'Tiempo de descanso y comunión.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'sabado-comfama',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '14:00',
    endsAt: '19:00',
    title: 'Tarde familiar en Comfama',
    description: 'Salida familiar a Comfama Tutucán. Llevar traje de baño para piscinas climatizadas.',
    audience: 'todos',
    trackLabel: 'General',
    location: 'Comfama Tutucán, Rionegro',
  },
  {
    id: 'sabado-cena',
    date: '2026-06-06',
    day: 'Sábado',
    startsAt: '19:00',
    endsAt: '21:00',
    title: 'Cena',
    description: 'Cierre práctico del primer día.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
    teamNotes: 'El Excel menciona cena 8:30 p.m.; confirmar si la hora pública debe moverse.',
    status: 'pending',
  },
  {
    id: 'domingo-oracion',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '05:30',
    endsAt: '06:30',
    title: 'Tiempo de oración',
    description: 'Madrugada de búsqueda, intercesión y preparación espiritual.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Gloria Cano',
    location: eventLocation,
  },
  {
    id: 'domingo-desayuno',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '06:30',
    endsAt: '08:00',
    title: 'Desayuno',
    description: 'Comunión antes de las enseñanzas de la mañana.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'domingo-evangelizando',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '08:00',
    endsAt: '09:00',
    title: 'Evangelizando la cultura y comunidad',
    description: 'Una enseñanza para llevar el evangelio a la vida real de nuestras ciudades.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Brett',
    responsible: 'Traductor: Ps. Felipe',
    delegation: 'Itagüí y Cali',
    location: eventLocation,
  },
  {
    id: 'domingo-ninos-manana',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '08:00',
    endsAt: '12:00',
    title: 'Clases ministerio infantil',
    description: 'Actividades de música, danza y evangelismo.',
    audience: 'ninos',
    trackLabel: 'Niños',
    responsible: 'Edwin, Cate y Aura',
    location: eventLocation,
  },
  {
    id: 'domingo-fundamentos',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '09:00',
    endsAt: '10:30',
    title: 'Establecer fundamentos bíblicos',
    description: 'Bases para afirmar discípulos, familias y comunidades en la Palabra.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Felipe',
    delegation: 'Escuela bíblica y México Tantoyuca',
    location: eventLocation,
  },
  {
    id: 'domingo-descanso',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '10:30',
    endsAt: '11:00',
    title: 'Descanso',
    description: 'Pausa breve antes del siguiente bloque.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'domingo-equipar',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '11:00',
    endsAt: '12:00',
    title: 'Equipar a los creyentes para ministrar',
    description: 'Activación práctica para servir con claridad, humildad y poder.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Gloria',
    location: eventLocation,
    teamNotes: 'Preparar con la pastora antes de publicar materiales.',
  },
  {
    id: 'domingo-campus-manana',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '11:00',
    endsAt: '12:00',
    title: 'Encuentro Campus',
    description: 'Espacio de coordinación y visión para Campus.',
    audience: 'campus',
    trackLabel: 'Campus',
    responsible: 'Rocio',
    location: eventLocation,
    teamNotes: 'Tema por confirmar con Campus.',
    status: 'pending',
  },
  {
    id: 'domingo-almuerzo',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '12:00',
    endsAt: '14:00',
    title: 'Almuerzo',
    description: 'Tiempo de descanso y comunión.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'domingo-mujeres-bienvenida',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '14:00',
    endsAt: '14:20',
    title: 'Bienvenida y alabanza - Mujeres',
    description: 'Apertura del encuentro de mujeres.',
    audience: 'mujeres',
    trackLabel: 'Mujeres',
    responsible: 'Ps. Gloria',
    location: eventLocation,
  },
  {
    id: 'domingo-varones-resistir',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '14:00',
    endsAt: '15:00',
    title: 'Resistir en la batalla',
    description: 'Encuentro de varones para afirmar el carácter y la perseverancia.',
    audience: 'varones',
    trackLabel: 'Varones',
    speaker: 'Carlos Betancur',
    responsible: 'Ernesto',
    location: eventLocation,
    teamNotes: 'Predicador por confirmar en el Excel.',
    status: 'pending',
  },
  {
    id: 'domingo-campus-tarde-brett',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '14:00',
    endsAt: '15:00',
    title: 'Campus con Ps. Brett',
    description: 'Espacio de visión y acompañamiento para Campus.',
    audience: 'campus',
    trackLabel: 'Campus',
    speaker: 'Ps. Brett',
    responsible: 'Rocio',
    location: eventLocation,
  },
  {
    id: 'domingo-ninos-tarde',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '14:00',
    endsAt: '18:00',
    title: 'Clases ministerio infantil',
    description: 'Actividades de música, danza y evangelismo.',
    audience: 'ninos',
    trackLabel: 'Niños',
    responsible: 'Edwin, Cate y Aura',
    location: eventLocation,
  },
  {
    id: 'domingo-mujeres-mqc',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '14:20',
    endsAt: '14:45',
    title: 'Presentación MQC',
    description: 'Presentación del enfoque y llamado del encuentro de mujeres.',
    audience: 'mujeres',
    trackLabel: 'Mujeres',
    responsible: 'Ps. Gloria',
    location: eventLocation,
  },
  {
    id: 'domingo-mujeres-virtudes',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '14:45',
    endsAt: '15:30',
    title: 'Virtudes',
    description: 'Enseñanza y conversación para mujeres.',
    audience: 'mujeres',
    trackLabel: 'Mujeres',
    responsible: 'Ps. Gloria',
    location: eventLocation,
  },
  {
    id: 'domingo-varones-brett',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '15:00',
    endsAt: '16:00',
    title: 'Varones con Ps. Brett',
    description: 'Enseñanza y ministración para el encuentro de varones.',
    audience: 'varones',
    trackLabel: 'Varones',
    speaker: 'Ps. Brett',
    responsible: 'Ernesto',
    location: eventLocation,
  },
  {
    id: 'domingo-campus-programacion',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '15:00',
    endsAt: '16:00',
    title: 'Encuentro Campus',
    description: 'Bloque de trabajo para Campus.',
    audience: 'campus',
    trackLabel: 'Campus',
    responsible: 'Rocio',
    location: eventLocation,
    teamNotes: 'Programar tema con Campus.',
    status: 'pending',
  },
  {
    id: 'domingo-mujeres-significado',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '15:30',
    endsAt: '16:30',
    title: 'Significado y actividad práctica',
    description: 'Actividad de aplicación para el encuentro de mujeres.',
    audience: 'mujeres',
    trackLabel: 'Mujeres',
    responsible: 'Ps. Gloria',
    location: eventLocation,
  },
  {
    id: 'domingo-varones-aventura',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '16:00',
    endsAt: '17:00',
    title: 'Vivir la aventura',
    description: 'Bloque práctico para el encuentro de varones.',
    audience: 'varones',
    trackLabel: 'Varones',
    responsible: 'Ernesto',
    location: eventLocation,
  },
  {
    id: 'domingo-pastoral-brett',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '16:00',
    endsAt: '17:00',
    title: 'Charla con Ps. Brett',
    description: 'Espacio reservado para equipo pastoral.',
    audience: 'pastoral',
    trackLabel: 'Equipo pastoral',
    speaker: 'Ps. Brett',
    location: eventLocation,
    public: false,
  },
  {
    id: 'domingo-mujeres-desafio',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '16:30',
    endsAt: '18:00',
    title: 'Desafío y oración final',
    description: 'Cierre del encuentro de mujeres.',
    audience: 'mujeres',
    trackLabel: 'Mujeres',
    responsible: 'Ps. Gloria',
    location: eventLocation,
  },
  {
    id: 'domingo-varones-rescatando',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '17:00',
    endsAt: '18:00',
    title: 'Rescatando la bella',
    description: 'Testimonios y cierre del encuentro de varones.',
    audience: 'varones',
    trackLabel: 'Varones',
    responsible: 'Ernesto',
    location: eventLocation,
    teamNotes: 'Testimonios por delegar.',
    status: 'pending',
  },
  {
    id: 'domingo-cena',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '18:00',
    endsAt: '19:30',
    title: 'Cena',
    description: 'Tiempo de descanso antes de la noche de las naciones.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'domingo-toldos',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '19:30',
    endsAt: '20:00',
    title: 'Revisión de toldos',
    description: 'Coordinación logística antes del bloque de la noche.',
    audience: 'logistica',
    trackLabel: 'Logística',
    location: eventLocation,
    public: false,
    status: 'pending',
    teamNotes: 'El Excel trae 07:30 después de cena; se interpreta como 7:30 p.m. Confirmar.',
  },
  {
    id: 'domingo-alabanza-danzas',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '20:00',
    endsAt: '21:00',
    title: 'Alabanza y danzas',
    description: 'Celebración y adoración con enfoque en las naciones.',
    audience: 'todos',
    trackLabel: 'General',
    responsible: 'Ps. Irma',
    location: eventLocation,
  },
  {
    id: 'domingo-testimonios-naciones',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '21:00',
    endsAt: '21:45',
    title: 'Testimonios de las naciones',
    description: 'Historias de lo que Dios está haciendo en Ecuador, Paris y USA.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Felipe',
    delegation: 'Ecuador, Paris y USA',
    location: eventLocation,
  },
  {
    id: 'domingo-oracion-naciones',
    date: '2026-06-07',
    day: 'Domingo',
    startsAt: '21:45',
    endsAt: '22:15',
    title: 'Oración de las naciones',
    description: 'Intercesión y cierre espiritual de la jornada.',
    audience: 'todos',
    trackLabel: 'General',
    responsible: 'Carlos y Gloria Claros',
    location: eventLocation,
  },
  {
    id: 'lunes-devocional',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '05:30',
    endsAt: '06:30',
    title: 'Devocional en vivo',
    description: 'Inicio del día en la presencia de Dios.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'lunes-desayuno',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '06:30',
    endsAt: '08:00',
    title: 'Desayuno',
    description: 'Comunión antes del cierre de la Cumbre.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
  {
    id: 'lunes-campus-generacion',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '08:00',
    endsAt: '09:00',
    title: 'Campus: la nueva generación',
    description: 'Visión para formar y enviar una nueva generación de discípulos.',
    audience: 'todos',
    trackLabel: 'General',
    delegation: 'Cartago y Armenia',
    location: eventLocation,
  },
  {
    id: 'lunes-ninos-clausura',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '08:00',
    endsAt: '10:00',
    title: 'Clausura ministerio infantil',
    description: 'Testimonios, premios y preparación de la presentación final.',
    audience: 'ninos',
    trackLabel: 'Niños',
    responsible: 'Edwin, Cate y Aura',
    location: eventLocation,
  },
  {
    id: 'lunes-empoderar',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '09:00',
    endsAt: '10:00',
    title: 'Empoderar',
    description: 'Enseñanza para salir enviados y fortalecidos en la misión.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Carlos Ríos',
    delegation: 'Bogotá y Bucaramanga',
    location: eventLocation,
  },
  {
    id: 'lunes-alabanza',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '10:30',
    endsAt: '10:45',
    title: 'Alabanza',
    description: 'Adoración antes de los actos de cierre.',
    audience: 'todos',
    trackLabel: 'General',
    responsible: 'Mateo Ríos - Paris',
    location: eventLocation,
  },
  {
    id: 'lunes-presentacion-infantil',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '10:45',
    endsAt: '11:00',
    title: 'Presentación ministerio infantil',
    description: 'Participación final de los niños en la Cumbre.',
    audience: 'todos',
    trackLabel: 'General',
    responsible: 'Edwin, Cate y Aura',
    location: eventLocation,
  },
  {
    id: 'lunes-clausura-brett',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '11:00',
    endsAt: '11:45',
    title: 'Clausura',
    description: 'Palabra final de envío y afirmación para la familia Maná.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Brett',
    location: eventLocation,
  },
  {
    id: 'lunes-consagracion',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '11:45',
    endsAt: '12:00',
    title: 'Consagración y Cena del Señor',
    description: 'Tiempo final de consagración como familia.',
    audience: 'todos',
    trackLabel: 'General',
    speaker: 'Ps. Carlos Ríos',
    location: eventLocation,
  },
  {
    id: 'lunes-almuerzo-final',
    date: '2026-06-08',
    day: 'Lunes',
    startsAt: '13:00',
    endsAt: '14:00',
    title: 'Almuerzo y cierre',
    description: 'Último espacio de comunión antes de regresar a casa.',
    audience: 'todos',
    trackLabel: 'General',
    location: eventLocation,
  },
];

export const delegationAssignments: DelegationAssignment[] = [
  { area: 'Alabanza', responsible: 'Mateo Ríos', detail: 'Paris' },
  { area: 'Varones', responsible: 'Ernesto' },
  { area: 'Mujeres', responsible: 'Ps. Gloria' },
  { area: 'Campus', responsible: 'Rocio' },
  { area: 'Niños', responsible: 'Edwin, Cate y Aura' },
  { area: 'Bienvenida', responsible: 'Raul' },
  { area: 'Tiempo de vigilia', responsible: 'Carlos y Gloria Claros' },
  { area: 'Noche de las naciones', responsible: 'Edwin y Aura' },
  { area: 'Clausura', responsible: 'Maria Camila' },
];

export const testimonyAssignments: TestimonyAssignment[] = [
  {
    moment: 'Domingo mañana',
    speaker: 'Ps. Brett',
    theme: 'Evangelizando la cultura y comunidad',
    delegations: 'Itagüí y Cali',
  },
  {
    moment: 'Domingo mañana',
    speaker: 'Ps. Felipe',
    theme: 'Establecer fundamentos bíblicos',
    delegations: 'Escuela bíblica y México Tantoyuca',
  },
  {
    moment: 'Domingo mañana',
    speaker: 'Ps. Gloria',
    theme: 'Equipar a los creyentes para ministrar',
  },
  {
    moment: 'Domingo noche de las naciones',
    speaker: 'Ps. Piter',
    theme: 'Testimonio de las naciones',
    delegations: 'Ecuador, Paris y Huehuetoca',
  },
  {
    moment: 'Lunes mañana',
    speaker: 'Ps. Carlos Ríos',
    theme: 'Empoderar',
    delegations: 'Bogotá y Bucaramanga',
  },
];

export function getPublicScheduleEvents() {
  return cumbreScheduleEvents
    .filter((event) => event.public !== false && event.status !== 'internal')
    .sort(sortScheduleEvents);
}

export function getTeamScheduleEvents() {
  return [...cumbreScheduleEvents].sort(sortScheduleEvents);
}

export function getEventsForDay(date: CumbreDay['date'], events = cumbreScheduleEvents) {
  return events.filter((event) => event.date === date).sort(sortScheduleEvents);
}

export function formatDisplayTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'p.m.' : 'a.m.';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function formatTimeRange(event: CumbreScheduleEvent) {
  return `${formatDisplayTime(event.startsAt)} - ${formatDisplayTime(event.endsAt)}`;
}

export function getCalendarLabel(event: CumbreScheduleEvent) {
  return `Cumbre Mundial 2026 - ${event.title}`;
}

export function getEventCalendarDescription(
  event: CumbreScheduleEvent,
  options: { includeTeamNotes?: boolean } = {}
) {
  const includeTeamNotes = options.includeTeamNotes ?? true;
  const parts = [
    event.description,
    event.speaker ? `Predicador: ${event.speaker}` : '',
    event.responsible ? `Responsable: ${event.responsible}` : '',
    event.delegation ? `Delegación: ${event.delegation}` : '',
    includeTeamNotes && event.teamNotes ? `Notas equipo: ${event.teamNotes}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

export function getGoogleCalendarUrl(event: CumbreScheduleEvent) {
  const dates = `${toUtcStamp(event.date, event.startsAt)}/${toUtcStamp(event.date, event.endsAt)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: getCalendarLabel(event),
    dates,
    details: getEventCalendarDescription(event),
    location: event.location ?? eventLocation,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function getIcsDataUri(event: CumbreScheduleEvent) {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcsCalendar([event]))}`;
}

export function getScheduleIcsDataUri(
  events: CumbreScheduleEvent[],
  calendarName = 'Cumbre Mundial 2026',
  options: { includeTeamNotes?: boolean } = {}
) {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcsCalendar(events, calendarName, options))}`;
}

export function getScheduleIcsText(
  events: CumbreScheduleEvent[],
  calendarName = 'Cumbre Mundial 2026',
  options: { includeTeamNotes?: boolean } = {}
) {
  return buildIcsCalendar(events, calendarName, options);
}

export function getCopyText(event: CumbreScheduleEvent) {
  const lines = [
    `${event.day} ${formatTimeRange(event)}`,
    event.title,
    event.description,
    event.speaker ? `Predicador: ${event.speaker}` : '',
    event.responsible ? `Responsable: ${event.responsible}` : '',
    event.delegation ? `Delegación: ${event.delegation}` : '',
    event.location ? `Lugar: ${event.location}` : '',
    event.teamNotes ? `Notas: ${event.teamNotes}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

function sortScheduleEvents(a: CumbreScheduleEvent, b: CumbreScheduleEvent) {
  return `${a.date} ${a.startsAt} ${a.audience}`.localeCompare(`${b.date} ${b.startsAt} ${b.audience}`);
}

function buildIcsCalendar(
  events: CumbreScheduleEvent[],
  calendarName = 'Cumbre Mundial 2026',
  options: { includeTeamNotes?: boolean } = {}
) {
  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ministerio Mana//Cumbre Mundial 2026//ES',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${event.id}@ministeriomana.org`,
      `DTSTAMP:${toUtcStamp('2026-06-02', '12:00')}`,
      `DTSTART:${toUtcStamp(event.date, event.startsAt)}`,
      `DTEND:${toUtcStamp(event.date, event.endsAt)}`,
      `SUMMARY:${escapeIcs(getCalendarLabel(event))}`,
      `DESCRIPTION:${escapeIcs(getEventCalendarDescription(event, options))}`,
      `LOCATION:${escapeIcs(event.location ?? eventLocation)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];

  return rows.join('\r\n');
}

function toUtcStamp(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hours + bogotaUtcOffsetHours, minutes));

  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
