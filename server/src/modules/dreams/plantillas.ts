// Plantillas de sueños: un sueño nuevo puede nacer con sus pasos ya escritos.
// La idea es evitar la página en blanco: «Viajar» no se empieza pensando qué
// campos rellenar, sino tachando países.
//
// Son datos, no configuración: añadir una plantilla es añadir una entrada aquí.

export interface Plantilla {
  id: string;
  title: string;
  emoji: string;
  description: string;
  steps: string[];
}

export const PLANTILLAS: Plantilla[] = [
  {
    id: 'viajar',
    title: 'Viajar',
    emoji: '✈️',
    description: 'Los sitios que quiero ver antes de que se me pase el arroz.',
    steps: [
      'Japón',
      'Islandia',
      'Nueva Zelanda',
      'Noruega',
      'Perú',
      'Marruecos',
      'Italia · Dolomitas',
      'Escocia',
      'Portugal · Azores',
      'Grecia',
      'Canadá',
      'Vietnam',
    ],
  },
  {
    id: 'leer',
    title: 'Leer',
    emoji: '📚',
    description: 'Los libros que quiero haber leído.',
    steps: [],
  },
  {
    id: 'idioma',
    title: 'Aprender un idioma',
    emoji: '🗣️',
    description: '',
    steps: [
      'Elegir el idioma y el método',
      'Primeras 100 palabras',
      'Aguantar una conversación de 5 minutos',
      'Ver una película sin subtítulos',
      'Un viaje usándolo de verdad',
    ],
  },
  {
    id: 'instrumento',
    title: 'Aprender un instrumento',
    emoji: '🎸',
    description: '',
    steps: [
      'Conseguir el instrumento',
      'Buscar profesor o curso',
      'Media hora al día durante un mes',
      'Tocar una canción entera de principio a fin',
      'Tocársela a alguien',
    ],
  },
  {
    id: 'casa',
    title: 'Casa propia',
    emoji: '🏡',
    description: '',
    steps: [
      'Decidir zona',
      'Calcular cuánto puedo pagar de verdad',
      'Reunir la entrada',
      'Hablar con el banco',
      'Empezar a visitar',
    ],
  },
  {
    id: 'camper',
    title: 'Camper o vehículo',
    emoji: '🚐',
    description: '',
    steps: [
      'Decidir modelo y presupuesto',
      'Comparar comprarla hecha o montarla',
      'Reunir el dinero',
      'Verla en persona',
      'Primer viaje',
    ],
  },
  {
    id: 'deporte',
    title: 'Un deporte nuevo',
    emoji: '🏄',
    description: '',
    steps: [
      'Probarlo una vez antes de gastar',
      'Conseguir el material básico',
      'Primer mes de constancia',
      'Apuntarme a algo con gente',
    ],
  },
];

export function plantilla(id: string): Plantilla | undefined {
  return PLANTILLAS.find((p) => p.id === id);
}
