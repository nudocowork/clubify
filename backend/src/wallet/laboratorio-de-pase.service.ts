import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { MediaService } from '../media/media.service';
import { WalletService } from './wallet.service';
import { GoogleWalletService } from './google-wallet.service';
import {
  aplicarProgreso,
  avisoDelCambio,
  cabeceraDelPase,
  validarPaseDeLaboratorio,
  type PaseDeLaboratorio,
} from './franja-de-laboratorio';

/**
 * Pruebas instaladas del laboratorio de tarjetas: crear el pase, listarlas y
 * sumarles o quitarles sellos para ver en el celular lo que verá un cliente.
 *
 * NO HAY TABLA, a propósito: guardarlas en la base obligaba a migrar
 * producción para algo que es una herramienta interna. Viven como JSON en el
 * bucket, bajo `laboratorio/pases/<id>/`:
 *
 *   diseno.json        el diseño validado (con imágenes; puede pesar MB)
 *   estado.json        lo ligero: avance, resumen para la lista, URLs
 *   dispositivos.json  iPhones registrados (deviceLibraryId + pushToken)
 *
 * y `laboratorio/dispositivos/<deviceLibraryId>.json` con los ids de prueba de
 * cada iPhone, porque Apple pregunta «qué cambió» POR DISPOSITIVO.
 *
 * El `authenticationToken` de Apple NO se guarda: se deriva del id con HMAC.
 * El bucket es público, y esa llave es la que deja pedir el pase al servidor.
 */

const PREFIJO = 'laboratorio/pases/';
const SERIAL = 'lab_';

type Estado = {
  id: string;
  creado: string;
  actualizado: string;
  negocio: string;
  titular: string;
  estilo: string;
  requeridos: number;
  premio: string;
  unidad: string;
  moneda: string;
  sellados: number;
  gastado: number;
  saldo: number;
  aviso: string | null;
  franjaUrl: string;
  appleUrl: string | null;
  googleUrl: string | null;
};

type Dispositivo = { deviceLibraryId: string; pushToken: string };

export type PruebaInstalada = Estado & { iphones: number; actualizaciones: boolean };

@Injectable()
export class LaboratorioDePaseService {
  private logger = new Logger(LaboratorioDePaseService.name);
  /**
   * iPhones SIN pruebas, recordados un rato. Apple pregunta «qué cambió» por
   * cada iPhone de cada cliente real; sin esto, cada una de esas preguntas
   * haría además una lectura al bucket que casi siempre da 404.
   */
  private sinPruebas = new Map<string, number>();

  constructor(
    private wallet: WalletService,
    private google: GoogleWalletService,
    private media: MediaService,
  ) {}

  static esSerialDeLaboratorio(serial: string): boolean {
    return serial.startsWith(SERIAL);
  }

  // ── llaves ────────────────────────────────────────────────────────────────

  private secreto(): string | null {
    return process.env.LABORATORIO_SECRET || process.env.JWT_SECRET || null;
  }

  private tokenDe(id: string): string | null {
    const s = this.secreto();
    return s ? createHmac('sha256', s).update(`laboratorio-pase:${id}`).digest('hex').slice(0, 40) : null;
  }

  private tokenValido(id: string, recibido: string): boolean {
    const esperado = this.tokenDe(id);
    if (!esperado || recibido.length !== esperado.length) return false;
    return timingSafeEqual(Buffer.from(esperado), Buffer.from(recibido));
  }

  /** `lab_<id>` → id, solo si tiene la forma que generamos (va dentro de una clave del bucket). */
  private idDelSerial(serial: string): string | null {
    const id = serial.slice(SERIAL.length);
    return /^[a-f0-9]{20}$/.test(id) ? id : null;
  }

  private static idValido(id: string) {
    if (!/^[a-f0-9]{20}$/.test(id)) throw new NotFoundException('Esa prueba no existe.');
  }

  private static claveDeDispositivo(deviceLibraryId: string): string | null {
    return /^[A-Za-z0-9]{8,128}$/.test(deviceLibraryId) ? `laboratorio/dispositivos/${deviceLibraryId}.json` : null;
  }

  // ── lectura ───────────────────────────────────────────────────────────────

  private estado(id: string) {
    return this.media.leerJson<Estado>(`${PREFIJO}${id}/estado.json`);
  }

  /** El diseño se vuelve a validar al leerlo: el bucket es de escritura nuestra, pero entra a un SVG. */
  private async diseno(id: string): Promise<PaseDeLaboratorio | null> {
    const d = await this.media.leerJson<unknown>(`${PREFIJO}${id}/diseno.json`);
    return d ? validarPaseDeLaboratorio(d) : null;
  }

  private async dispositivos(id: string): Promise<Dispositivo[]> {
    return (await this.media.leerJson<Dispositivo[]>(`${PREFIJO}${id}/dispositivos.json`)) ?? [];
  }

  // ── panel ─────────────────────────────────────────────────────────────────

  async crear(cuerpo: unknown) {
    const { config, negocio, titular } = validarPaseDeLaboratorio(cuerpo);
    const id = randomUUID().replace(/-/g, '').slice(0, 20);
    const cabecera = cabeceraDelPase(config);
    const token = this.tokenDe(id);

    const franja = await this.wallet.dibujarFranjaDeLaboratorio(config);
    const hero = await this.media.uploadRaw({
      folder: 'laboratorio',
      fileName: 'franja.png',
      buffer: franja['strip@3x.png'],
      contentType: 'image/png',
    });

    const pkpass = await this.wallet.generarPaseDeLaboratorio({ id, negocio, titular, config, cabecera, franja, token });
    const apple = pkpass
      ? await this.media.uploadRaw({
          folder: 'laboratorio',
          fileName: 'tarjeta.pkpass',
          buffer: pkpass,
          contentType: 'application/vnd.apple.pkpass',
        })
      : null;

    const googleUrl = this.google.urlDeLaboratorio({
      id,
      negocio,
      titular,
      premio: config.premio,
      fondo: config.fondo,
      cabecera,
      heroUrl: hero.url,
    });

    if (!apple && !googleUrl) {
      throw new ServiceUnavailableException('Las billeteras no están configuradas en este servidor.');
    }

    const ahora = new Date().toISOString();
    const estado: Estado = {
      id,
      creado: ahora,
      actualizado: ahora,
      negocio,
      titular,
      estilo: config.estilo,
      requeridos: config.requeridos,
      premio: config.premio,
      unidad: config.unidad,
      moneda: config.moneda ?? '$',
      sellados: config.sellados,
      gastado: config.gastado ?? 0,
      saldo: config.saldo ?? 0,
      aviso: null,
      franjaUrl: hero.url,
      appleUrl: apple?.url ?? null,
      googleUrl,
    };
    // Si guardar falla, el pase igual sirve para verlo; solo no se podrá mover.
    await Promise.all([
      this.media.guardarJson(`${PREFIJO}${id}/diseno.json`, { config, negocio, titular }),
      this.media.guardarJson(`${PREFIJO}${id}/estado.json`, estado),
    ]).catch((e) => this.logger.warn(`Laboratorio ${id}: no se guardó el estado (${e?.message ?? e})`));

    this.logger.log(`Pase de laboratorio ${id}: estilo=${config.estilo} apple=${!!apple} google=${!!googleUrl}`);
    return { id, franjaUrl: hero.url, appleUrl: apple?.url ?? null, googleUrl };
  }

  async listar(): Promise<PruebaInstalada[]> {
    const claves = (await this.media.listarClaves(PREFIJO)).filter((k) => k.endsWith('/estado.json'));
    const items = await Promise.all(
      claves.map(async (k) => {
        const id = k.slice(PREFIJO.length, -'/estado.json'.length);
        const [e, d] = await Promise.all([this.estado(id), this.dispositivos(id)]);
        return e ? { ...e, iphones: d.length, actualizaciones: !!this.tokenDe(id) } : null;
      }),
    );
    return items
      .filter((x): x is PruebaInstalada => !!x)
      .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
  }

  /**
   * Suma o quita sellos (o gasto, o saldo) y lo lleva a los celulares: franja
   * nueva, push a los iPhones y patch en Google, como cuando se sella en caja.
   */
  async moverProgreso(id: string, cuerpo: unknown) {
    LaboratorioDePaseService.idValido(id);
    const [estado, diseno] = await Promise.all([this.estado(id), this.diseno(id)]);
    if (!estado || !diseno) throw new NotFoundException('Esa prueba no existe.');

    const antes = { ...diseno.config, sellados: estado.sellados, gastado: estado.gastado, saldo: estado.saldo };
    const despues = aplicarProgreso(antes, cuerpo);
    const aviso = avisoDelCambio(antes, despues);
    const cabecera = cabeceraDelPase(despues);

    const franja = await this.wallet.dibujarFranjaDeLaboratorio(despues);
    // Archivo NUEVO cada vez: Google cachea la imagen por URL y no la vuelve a
    // bajar si la URL es la misma.
    const hero = await this.media.uploadRaw({
      folder: 'laboratorio',
      fileName: 'franja.png',
      buffer: franja['strip@3x.png'],
      contentType: 'image/png',
    });

    const nuevo: Estado = {
      ...estado,
      sellados: despues.sellados,
      gastado: despues.gastado ?? 0,
      saldo: despues.saldo ?? 0,
      aviso: aviso ?? estado.aviso,
      franjaUrl: hero.url,
      // Apple compara contra esta fecha (If-Modified-Since, en segundos): si
      // no cambia, el iPhone recibe 304 y se queda con la vieja.
      actualizado: new Date().toISOString(),
    };
    // Se guarda ANTES de avisar: el iPhone pide el pase apenas le llega el push.
    await this.media.guardarJson(`${PREFIJO}${id}/estado.json`, nuevo);

    const dispositivos = await this.dispositivos(id);
    const [apple, google] = await Promise.all([
      this.wallet.avisarDispositivosDeLaboratorio(dispositivos.map((d) => d.pushToken)),
      this.google.actualizarLaboratorio({ id, cabecera, heroUrl: hero.url, aviso }),
    ]);
    if (apple.muertos.length) {
      await this.guardarDispositivos(
        id,
        dispositivos.filter((d) => !apple.muertos.includes(d.pushToken)),
      );
    }
    this.logger.log(
      `Laboratorio ${id}: ${cabecera.valor} · apple ${apple.enviados}/${dispositivos.length} · google ${google}`,
    );
    return {
      prueba: { ...nuevo, iphones: dispositivos.length - apple.muertos.length, actualizaciones: !!this.tokenDe(id) },
      apple: { enviados: apple.enviados, fallidos: apple.fallidos },
      google,
    };
  }

  /** Solo la quita de la lista: el pase instalado se queda en el celular, congelado. */
  async quitar(id: string) {
    LaboratorioDePaseService.idValido(id);
    const dispositivos = await this.dispositivos(id);
    await Promise.all(
      dispositivos.map((d) => this.quitarDelDispositivo(d.deviceLibraryId, id).catch(() => null)),
    );
    await Promise.all(
      ['estado.json', 'diseno.json', 'dispositivos.json'].map((f) =>
        this.media.borrar(`${PREFIJO}${id}/${f}`).catch(() => null),
      ),
    );
    return { ok: true };
  }

  // ── servicio web de Apple (lo llama WalletController) ──────────────────────

  /** Registro de un iPhone. `false` = 401 para Apple. */
  async registrar(serial: string, token: string, deviceLibraryId: string, pushToken: string): Promise<boolean> {
    const id = this.idDelSerial(serial);
    const clave = LaboratorioDePaseService.claveDeDispositivo(deviceLibraryId);
    if (!id || !clave || !this.tokenValido(id, token) || !(await this.estado(id))) return false;

    const lista = (await this.dispositivos(id)).filter((d) => d.deviceLibraryId !== deviceLibraryId);
    lista.push({ deviceLibraryId, pushToken });
    await this.guardarDispositivos(id, lista);

    const ids = new Set((await this.media.leerJson<string[]>(clave)) ?? []);
    ids.add(id);
    await this.media.guardarJson(clave, [...ids]);
    this.sinPruebas.delete(deviceLibraryId);
    this.logger.log(`Laboratorio ${id}: iPhone registrado (${lista.length} en total)`);
    return true;
  }

  async darDeBaja(serial: string, deviceLibraryId: string) {
    const id = this.idDelSerial(serial);
    if (!id) return;
    await this.guardarDispositivos(
      id,
      (await this.dispositivos(id)).filter((d) => d.deviceLibraryId !== deviceLibraryId),
    );
    await this.quitarDelDispositivo(deviceLibraryId, id);
  }

  /**
   * Seriales de prueba de este iPhone, para sumarlos a la respuesta de «qué
   * cambió». Nunca rompe esa respuesta: es la de los pases reales también.
   */
  async serialesDelDispositivo(deviceLibraryId: string): Promise<string[]> {
    const clave = LaboratorioDePaseService.claveDeDispositivo(deviceLibraryId);
    if (!clave) return [];
    const hasta = this.sinPruebas.get(deviceLibraryId);
    if (hasta && hasta > Date.now()) return [];
    try {
      const ids = (await this.media.leerJson<string[]>(clave)) ?? [];
      if (ids.length === 0) this.sinPruebas.set(deviceLibraryId, Date.now() + 10 * 60_000);
      return ids.map((i) => `${SERIAL}${i}`);
    } catch (e: any) {
      this.logger.warn(`Laboratorio: no se leyeron las pruebas del iPhone (${e?.message ?? e})`);
      return [];
    }
  }

  /** El .pkpass al día, para el GET de Apple. `null` = 401. */
  async paseActual(serial: string, token: string): Promise<{ buf: Buffer; actualizado: Date } | null> {
    const id = this.idDelSerial(serial);
    if (!id || !this.tokenValido(id, token)) return null;
    const [estado, diseno] = await Promise.all([this.estado(id), this.diseno(id)]);
    if (!estado || !diseno) return null;
    const config = { ...diseno.config, sellados: estado.sellados, gastado: estado.gastado, saldo: estado.saldo };
    const franja = await this.wallet.dibujarFranjaDeLaboratorio(config);
    const buf = await this.wallet.generarPaseDeLaboratorio({
      id,
      negocio: diseno.negocio,
      titular: diseno.titular,
      config,
      cabecera: cabeceraDelPase(config),
      franja,
      token: this.tokenDe(id),
      aviso: estado.aviso,
    });
    return buf ? { buf, actualizado: new Date(estado.actualizado) } : null;
  }

  private guardarDispositivos(id: string, lista: Dispositivo[]) {
    return this.media.guardarJson(`${PREFIJO}${id}/dispositivos.json`, lista);
  }

  private async quitarDelDispositivo(deviceLibraryId: string, id: string) {
    const clave = LaboratorioDePaseService.claveDeDispositivo(deviceLibraryId);
    if (!clave) return;
    const ids = ((await this.media.leerJson<string[]>(clave)) ?? []).filter((i) => i !== id);
    if (ids.length) await this.media.guardarJson(clave, ids);
    else await this.media.borrar(clave).catch(() => null);
  }
}
