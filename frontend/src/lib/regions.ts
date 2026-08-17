/**
 * Multi-país: estados/provincias para los dropdowns del checkout y otras
 * UIs que necesitan ubicación. Cubre los principales países LATAM + ES + US.
 *
 * Estructura: por país, una lista de "regiones" (estado/depto/provincia
 * según corresponda) y para cada una opcionalmente una lista de ciudades
 * principales. Si una región no tiene ciudades curadas, el usuario escribe
 * la ciudad como texto libre (opción "Otra").
 *
 * Para datos ya existentes de Colombia, importamos desde co-locations.ts
 * para evitar duplicación. Otros países: datos curados con las ciudades
 * más representativas (capital + 5-10 más grandes).
 *
 * Labels dinámicos por país: en CO se dice "Departamento/Municipio", en MX
 * "Estado/Ciudad", en AR "Provincia/Localidad", etc. Cada país define sus
 * labels para que la UI hable el idioma local.
 */

import { CO_LOCATIONS } from './co-locations';

export type Region = {
  /** Nombre de la región (estado/depto/provincia). */
  name: string;
  /** Ciudades principales pre-curadas. Si vacío → input libre. */
  cities: string[];
};

export type CountryRegions = {
  /** ISO 3166-1 alpha-2. */
  code: string;
  flag: string;
  name: string;
  /** Label para el primer dropdown (estado/depto/provincia). */
  regionLabel: string;
  /** Label para el segundo dropdown (municipio/ciudad/localidad). */
  cityLabel: string;
  regions: Region[];
};

// Convertimos CO_LOCATIONS al shape Region[].
const COLOMBIA_REGIONS: Region[] = CO_LOCATIONS.map((d) => ({
  name: d.departamento,
  cities: d.municipios,
}));

const MEXICO_REGIONS: Region[] = [
  { name: 'Ciudad de México', cities: ['CDMX', 'Iztapalapa', 'Coyoacán', 'Tlalpan', 'Álvaro Obregón', 'Cuauhtémoc', 'Miguel Hidalgo'] },
  { name: 'Jalisco', cities: ['Guadalajara', 'Zapopan', 'Tlaquepaque', 'Tonalá', 'Puerto Vallarta'] },
  { name: 'Nuevo León', cities: ['Monterrey', 'Guadalupe', 'San Nicolás', 'San Pedro Garza', 'Apodaca'] },
  { name: 'Estado de México', cities: ['Toluca', 'Ecatepec', 'Nezahualcóyotl', 'Naucalpan', 'Tlalnepantla'] },
  { name: 'Puebla', cities: ['Puebla', 'Cholula', 'Tehuacán', 'Atlixco'] },
  { name: 'Guanajuato', cities: ['León', 'Irapuato', 'Celaya', 'Salamanca', 'Guanajuato'] },
  { name: 'Querétaro', cities: ['Querétaro', 'San Juan del Río', 'Corregidora'] },
  { name: 'Baja California', cities: ['Tijuana', 'Mexicali', 'Ensenada', 'Rosarito'] },
  { name: 'Quintana Roo', cities: ['Cancún', 'Playa del Carmen', 'Cozumel', 'Tulum'] },
  { name: 'Yucatán', cities: ['Mérida', 'Valladolid', 'Progreso'] },
  { name: 'Veracruz', cities: ['Veracruz', 'Xalapa', 'Coatzacoalcos', 'Boca del Río'] },
  { name: 'Chihuahua', cities: ['Chihuahua', 'Ciudad Juárez', 'Delicias'] },
  { name: 'Sinaloa', cities: ['Culiacán', 'Mazatlán', 'Los Mochis'] },
  { name: 'Sonora', cities: ['Hermosillo', 'Ciudad Obregón', 'Nogales'] },
  { name: 'Oaxaca', cities: ['Oaxaca de Juárez', 'Salina Cruz', 'Tuxtepec'] },
  { name: 'Chiapas', cities: ['Tuxtla Gutiérrez', 'San Cristóbal de las Casas', 'Tapachula'] },
  { name: 'Michoacán', cities: ['Morelia', 'Uruapan', 'Zamora'] },
  { name: 'Tamaulipas', cities: ['Reynosa', 'Tampico', 'Matamoros', 'Nuevo Laredo'] },
  { name: 'Coahuila', cities: ['Saltillo', 'Torreón', 'Monclova'] },
  { name: 'San Luis Potosí', cities: ['San Luis Potosí', 'Soledad de Graciano Sánchez'] },
];

const ARGENTINA_REGIONS: Region[] = [
  { name: 'Ciudad de Buenos Aires', cities: ['CABA'] },
  { name: 'Buenos Aires', cities: ['La Plata', 'Mar del Plata', 'Bahía Blanca', 'Tigre', 'Quilmes', 'Vicente López'] },
  { name: 'Córdoba', cities: ['Córdoba', 'Villa María', 'Río Cuarto', 'Carlos Paz'] },
  { name: 'Santa Fe', cities: ['Rosario', 'Santa Fe', 'Rafaela'] },
  { name: 'Mendoza', cities: ['Mendoza', 'San Rafael', 'Godoy Cruz'] },
  { name: 'Tucumán', cities: ['San Miguel de Tucumán', 'Tafí Viejo'] },
  { name: 'Entre Ríos', cities: ['Paraná', 'Concordia', 'Gualeguaychú'] },
  { name: 'Salta', cities: ['Salta', 'Cafayate'] },
  { name: 'Misiones', cities: ['Posadas', 'Puerto Iguazú'] },
  { name: 'Chaco', cities: ['Resistencia'] },
  { name: 'Corrientes', cities: ['Corrientes'] },
  { name: 'Santiago del Estero', cities: ['Santiago del Estero'] },
  { name: 'San Juan', cities: ['San Juan'] },
  { name: 'Jujuy', cities: ['San Salvador de Jujuy'] },
  { name: 'Río Negro', cities: ['Bariloche', 'Viedma', 'Gral. Roca'] },
  { name: 'Neuquén', cities: ['Neuquén'] },
  { name: 'Formosa', cities: ['Formosa'] },
  { name: 'Chubut', cities: ['Comodoro Rivadavia', 'Trelew', 'Puerto Madryn'] },
  { name: 'San Luis', cities: ['San Luis'] },
  { name: 'Catamarca', cities: ['San Fernando del Valle de Catamarca'] },
  { name: 'La Pampa', cities: ['Santa Rosa'] },
  { name: 'La Rioja', cities: ['La Rioja'] },
  { name: 'Santa Cruz', cities: ['Río Gallegos', 'El Calafate'] },
  { name: 'Tierra del Fuego', cities: ['Ushuaia', 'Río Grande'] },
];

const CHILE_REGIONS: Region[] = [
  { name: 'Región Metropolitana', cities: ['Santiago', 'Providencia', 'Las Condes', 'Maipú', 'Ñuñoa'] },
  { name: 'Valparaíso', cities: ['Valparaíso', 'Viña del Mar', 'Quilpué', 'Villa Alemana', 'Concón', 'Quintero', 'Casablanca', 'Quillota', 'Calera', 'La Cruz', 'Nogales', 'Hijuelas', 'San Antonio', 'Cartagena', 'San Felipe', 'Los Andes', 'La Ligua'] },
  { name: 'Biobío', cities: ['Concepción', 'Talcahuano', 'Los Ángeles'] },
  { name: 'La Araucanía', cities: ['Temuco', 'Pucón'] },
  { name: 'Maule', cities: ['Talca', 'Curicó'] },
  { name: "O'Higgins", cities: ['Rancagua', 'San Fernando'] },
  { name: 'Antofagasta', cities: ['Antofagasta', 'Calama'] },
  { name: 'Coquimbo', cities: ['La Serena', 'Coquimbo'] },
  { name: 'Los Lagos', cities: ['Puerto Montt', 'Osorno'] },
  { name: 'Tarapacá', cities: ['Iquique'] },
  { name: 'Atacama', cities: ['Copiapó'] },
  { name: 'Arica y Parinacota', cities: ['Arica'] },
  { name: 'Magallanes', cities: ['Punta Arenas'] },
  { name: 'Aysén', cities: ['Coyhaique'] },
  { name: 'Los Ríos', cities: ['Valdivia'] },
  { name: 'Ñuble', cities: ['Chillán'] },
];

const PERU_REGIONS: Region[] = [
  { name: 'Lima', cities: ['Lima', 'Miraflores', 'San Isidro', 'Surco', 'La Molina', 'Callao'] },
  { name: 'Arequipa', cities: ['Arequipa'] },
  { name: 'La Libertad', cities: ['Trujillo'] },
  { name: 'Cusco', cities: ['Cusco', 'Urubamba'] },
  { name: 'Piura', cities: ['Piura', 'Sullana'] },
  { name: 'Lambayeque', cities: ['Chiclayo'] },
  { name: 'Junín', cities: ['Huancayo'] },
  { name: 'Áncash', cities: ['Chimbote', 'Huaraz'] },
  { name: 'Tacna', cities: ['Tacna'] },
  { name: 'Ica', cities: ['Ica', 'Chincha Alta'] },
  { name: 'Loreto', cities: ['Iquitos'] },
  { name: 'San Martín', cities: ['Tarapoto'] },
  { name: 'Cajamarca', cities: ['Cajamarca', 'Jaén'] },
  { name: 'Puno', cities: ['Puno', 'Juliaca'] },
  { name: 'Apurímac', cities: ['Abancay', 'Andahuaylas', 'Chincheros'] },
  { name: 'Amazonas', cities: ['Chachapoyas', 'Bagua'] },
  { name: 'Ayacucho', cities: ['Ayacucho', 'Huanta'] },
  { name: 'Huancavelica', cities: ['Huancavelica'] },
  { name: 'Huánuco', cities: ['Huánuco', 'Tingo María'] },
  { name: 'Madre de Dios', cities: ['Puerto Maldonado'] },
  { name: 'Moquegua', cities: ['Moquegua', 'Ilo'] },
  { name: 'Pasco', cities: ['Cerro de Pasco', 'Oxapampa'] },
  { name: 'Tumbes', cities: ['Tumbes'] },
  { name: 'Ucayali', cities: ['Pucallpa'] },
];

const ECUADOR_REGIONS: Region[] = [
  { name: 'Pichincha', cities: ['Quito'] },
  { name: 'Guayas', cities: ['Guayaquil', 'Durán'] },
  { name: 'Manabí', cities: ['Manta', 'Portoviejo'] },
  { name: 'Azuay', cities: ['Cuenca'] },
  { name: 'Tungurahua', cities: ['Ambato'] },
  { name: 'Loja', cities: ['Loja'] },
  { name: 'Imbabura', cities: ['Ibarra', 'Otavalo'] },
  { name: 'El Oro', cities: ['Machala'] },
  { name: 'Los Ríos', cities: ['Babahoyo'] },
  { name: 'Esmeraldas', cities: ['Esmeraldas'] },
];

const VENEZUELA_REGIONS: Region[] = [
  { name: 'Distrito Capital', cities: ['Caracas'] },
  { name: 'Zulia', cities: ['Maracaibo', 'Cabimas'] },
  { name: 'Carabobo', cities: ['Valencia'] },
  { name: 'Miranda', cities: ['Los Teques'] },
  { name: 'Aragua', cities: ['Maracay'] },
  { name: 'Lara', cities: ['Barquisimeto'] },
  { name: 'Bolívar', cities: ['Ciudad Bolívar', 'Puerto Ordaz'] },
  { name: 'Anzoátegui', cities: ['Barcelona', 'Puerto La Cruz'] },
  { name: 'Mérida', cities: ['Mérida'] },
  { name: 'Táchira', cities: ['San Cristóbal'] },
  { name: 'Nueva Esparta', cities: ['Porlamar'] },
  { name: 'Falcón', cities: ['Coro', 'Punto Fijo'] },
  { name: 'Sucre', cities: ['Cumaná'] },
  { name: 'Yaracuy', cities: ['San Felipe'] },
  { name: 'Trujillo', cities: ['Trujillo'] },
];

const BELIZE_REGIONS: Region[] = [
  { name: 'Belize', cities: ['Belize City', 'San Pedro', 'Caye Caulker', 'Ladyville'] },
  { name: 'Cayo', cities: ['Belmopan', 'San Ignacio', 'Santa Elena', 'Benque Viejo'] },
  { name: 'Corozal', cities: ['Corozal Town'] },
  { name: 'Orange Walk', cities: ['Orange Walk Town'] },
  { name: 'Stann Creek', cities: ['Dangriga', 'Placencia', 'Hopkins'] },
  { name: 'Toledo', cities: ['Punta Gorda'] },
];

export const COUNTRIES: Record<string, CountryRegions> = {
  CO: {
    code: 'CO',
    flag: '🇨🇴',
    name: 'Colombia',
    regionLabel: 'Departamento',
    cityLabel: 'Municipio',
    regions: COLOMBIA_REGIONS,
  },
  MX: {
    code: 'MX',
    flag: '🇲🇽',
    name: 'México',
    regionLabel: 'Estado',
    cityLabel: 'Ciudad',
    regions: MEXICO_REGIONS,
  },
  AR: {
    code: 'AR',
    flag: '🇦🇷',
    name: 'Argentina',
    regionLabel: 'Provincia',
    cityLabel: 'Localidad',
    regions: ARGENTINA_REGIONS,
  },
  CL: {
    code: 'CL',
    flag: '🇨🇱',
    name: 'Chile',
    regionLabel: 'Región',
    cityLabel: 'Comuna',
    regions: CHILE_REGIONS,
  },
  PE: {
    code: 'PE',
    flag: '🇵🇪',
    name: 'Perú',
    regionLabel: 'Departamento',
    cityLabel: 'Distrito',
    regions: PERU_REGIONS,
  },
  EC: {
    code: 'EC',
    flag: '🇪🇨',
    name: 'Ecuador',
    regionLabel: 'Provincia',
    cityLabel: 'Cantón',
    regions: ECUADOR_REGIONS,
  },
  VE: {
    code: 'VE',
    flag: '🇻🇪',
    name: 'Venezuela',
    regionLabel: 'Estado',
    cityLabel: 'Ciudad',
    regions: VENEZUELA_REGIONS,
  },
  BZ: {
    code: 'BZ',
    flag: '🇧🇿',
    name: 'Belice',
    regionLabel: 'Distrito',
    cityLabel: 'Ciudad',
    regions: BELIZE_REGIONS,
  },
};

/** Fallback genérico para países sin datos curados: el cliente escribe
 *  región y ciudad como texto libre. */
export const GENERIC_FALLBACK: CountryRegions = {
  code: 'XX',
  flag: '🌍',
  name: 'Otro país',
  regionLabel: 'Estado / Provincia',
  cityLabel: 'Ciudad',
  regions: [],
};

/** Resuelve el dataset según el country ISO 2-letter del tenant. */
export function regionsForCountry(country: string | null | undefined): CountryRegions {
  if (!country) return COUNTRIES.CO;
  const upper = country.toUpperCase();
  return COUNTRIES[upper] ?? GENERIC_FALLBACK;
}

export const OTRO_CITY_VALUE = '__OTRO__';
