/**
 * Departamentos y municipios de Colombia para los dropdowns del checkout
 * de delivery. Cubre los 33 departamentos y los principales municipios
 * (capital + 5-15 ciudades grandes/medianas). Para municipios fuera de la
 * lista, el usuario elige "Otro municipio" y escribe el nombre.
 */

export type CoLocation = {
  departamento: string;
  municipios: string[];
};

export const CO_LOCATIONS: CoLocation[] = [
  {
    departamento: 'Amazonas',
    municipios: ['Leticia', 'Puerto Nariño'],
  },
  {
    departamento: 'Antioquia',
    municipios: [
      'Medellín', 'Bello', 'Itagüí', 'Envigado', 'Sabaneta', 'La Estrella',
      'Caldas', 'Copacabana', 'Girardota', 'Apartadó', 'Turbo', 'Rionegro',
      'Marinilla', 'La Ceja', 'El Carmen de Viboral', 'Yarumal', 'Caucasia',
    ],
  },
  {
    departamento: 'Arauca',
    municipios: ['Arauca', 'Saravena', 'Tame', 'Arauquita'],
  },
  {
    departamento: 'Atlántico',
    municipios: [
      'Barranquilla', 'Soledad', 'Malambo', 'Puerto Colombia', 'Galapa',
      'Sabanagrande', 'Sabanalarga',
    ],
  },
  {
    departamento: 'Bogotá D.C.',
    municipios: ['Bogotá'],
  },
  {
    departamento: 'Bolívar',
    municipios: [
      'Cartagena', 'Magangué', 'Turbaco', 'Arjona', 'El Carmen de Bolívar',
      'Mompox',
    ],
  },
  {
    departamento: 'Boyacá',
    municipios: [
      'Tunja', 'Duitama', 'Sogamoso', 'Chiquinquirá', 'Paipa', 'Villa de Leyva',
    ],
  },
  {
    departamento: 'Caldas',
    municipios: ['Manizales', 'La Dorada', 'Chinchiná', 'Villamaría', 'Riosucio'],
  },
  {
    departamento: 'Caquetá',
    municipios: ['Florencia', 'San Vicente del Caguán', 'Belén de los Andaquíes'],
  },
  {
    departamento: 'Casanare',
    municipios: ['Yopal', 'Aguazul', 'Villanueva', 'Tauramena', 'Paz de Ariporo'],
  },
  {
    departamento: 'Cauca',
    municipios: ['Popayán', 'Santander de Quilichao', 'Puerto Tejada', 'Patía'],
  },
  {
    departamento: 'Cesar',
    municipios: ['Valledupar', 'Aguachica', 'Bosconia', 'Codazzi', 'La Jagua de Ibirico'],
  },
  {
    departamento: 'Chocó',
    municipios: ['Quibdó', 'Istmina', 'Tadó', 'Condoto'],
  },
  {
    departamento: 'Córdoba',
    municipios: ['Montería', 'Cereté', 'Lorica', 'Sahagún', 'Planeta Rica', 'Tierralta'],
  },
  {
    departamento: 'Cundinamarca',
    municipios: [
      'Soacha', 'Chía', 'Zipaquirá', 'Facatativá', 'Mosquera', 'Madrid',
      'Funza', 'Cajicá', 'Fusagasugá', 'Girardot', 'La Calera', 'Cota', 'Tenjo',
      'Sopó', 'Tabio', 'Tocancipá', 'Sibaté',
    ],
  },
  {
    departamento: 'Guainía',
    municipios: ['Inírida'],
  },
  {
    departamento: 'Guaviare',
    municipios: ['San José del Guaviare', 'Calamar', 'El Retorno'],
  },
  {
    departamento: 'Huila',
    municipios: ['Neiva', 'Pitalito', 'Garzón', 'La Plata', 'Campoalegre'],
  },
  {
    departamento: 'La Guajira',
    municipios: ['Riohacha', 'Maicao', 'Uribia', 'San Juan del Cesar', 'Manaure'],
  },
  {
    departamento: 'Magdalena',
    municipios: ['Santa Marta', 'Ciénaga', 'Fundación', 'El Banco', 'Plato'],
  },
  {
    departamento: 'Meta',
    municipios: ['Villavicencio', 'Acacías', 'Granada', 'Puerto López', 'Cumaral'],
  },
  {
    departamento: 'Nariño',
    municipios: ['Pasto', 'Tumaco', 'Ipiales', 'Túquerres', 'La Unión'],
  },
  {
    departamento: 'Norte de Santander',
    municipios: ['Cúcuta', 'Ocaña', 'Pamplona', 'Villa del Rosario', 'Los Patios'],
  },
  {
    departamento: 'Putumayo',
    municipios: ['Mocoa', 'Puerto Asís', 'Orito', 'Valle del Guamuez'],
  },
  {
    departamento: 'Quindío',
    municipios: ['Armenia', 'Calarcá', 'La Tebaida', 'Montenegro', 'Quimbaya', 'Filandia'],
  },
  {
    departamento: 'Risaralda',
    municipios: ['Pereira', 'Dosquebradas', 'Santa Rosa de Cabal', 'La Virginia'],
  },
  {
    departamento: 'San Andrés y Providencia',
    municipios: ['San Andrés', 'Providencia'],
  },
  {
    departamento: 'Santander',
    municipios: [
      'Bucaramanga', 'Floridablanca', 'Girón', 'Piedecuesta', 'Barrancabermeja',
      'San Gil', 'Socorro', 'Málaga',
    ],
  },
  {
    departamento: 'Sucre',
    municipios: ['Sincelejo', 'Corozal', 'Sampués', 'San Marcos', 'Tolú'],
  },
  {
    departamento: 'Tolima',
    municipios: ['Ibagué', 'Espinal', 'Melgar', 'Honda', 'Líbano', 'Mariquita'],
  },
  {
    departamento: 'Valle del Cauca',
    municipios: [
      'Cali', 'Palmira', 'Buenaventura', 'Tuluá', 'Cartago', 'Buga',
      'Jamundí', 'Yumbo', 'Candelaria', 'Florida',
    ],
  },
  {
    departamento: 'Vaupés',
    municipios: ['Mitú'],
  },
  {
    departamento: 'Vichada',
    municipios: ['Puerto Carreño', 'La Primavera', 'Cumaribo'],
  },
];

export const OTRO_MUNICIPIO = 'Otro municipio';
