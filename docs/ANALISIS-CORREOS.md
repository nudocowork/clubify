# Análisis de lo construido — correos automáticos por marca

**Fecha:** 2026-08-20 · **Rama:** `chore/merge-emails-sobre-314` @ `ea074a21`

Este documento va de lo más pequeño a lo más grande. Cada afirmación dice **cómo
se comprobó**. Donde no pude comprobar algo, lo digo en vez de suponerlo.

---

## Nivel 1 — La plantilla

16 plantillas de correo, cada una con `id`, asunto, cuerpo por defecto, lista de
variables, carpeta, público y botón de acción.

El texto por defecto está en español con tildes y eñes correctas: lo leen
clientes reales. Cada marca puede pisar **asunto y cuerpo por separado**
(herencia `marca > global > default`), así que una marca puede tocar solo el
asunto sin heredar el cuerpo de nadie.

El cuerpo que edita la marca es **texto plano**. El HTML lo pone el sistema. Lo
que la marca escribe se escapa antes de renderizar, así que el editor del panel
no puede inyectar HTML en un correo que va a un cliente.

> **Comprobado:** conteo sobre el catálogo → 16 ids.
> `brand-email-templates.spec.ts` → 25 tests en verde.

## Nivel 2 — El disparador

Las 16 tienen un punto de llamada real. Ninguna es decorativa.

| Origen | Plantillas que dispara |
|---|---|
| Cron de cobros | 7d, 3d, mañana, hoy, mora, va-a-pausar, pausada |
| Stripe | confirmado, fallido, disputa, reembolso, chargeback, cancelación, reactivada, panel listo |
| Hotmart | las mismas de Stripe + cambio de fecha de cobro |

Esto está protegido por un test que **falla si alguien agrega una plantilla y se
olvida de dispararla**. Se escribió porque ya pasó: en una reconciliación de
ramas se perdieron tres disparadores y nada lo detectó.

> **Comprobado:** para cada uno de los 16 ids, búsqueda de su punto de llamada
> fuera del catálogo. 16/16 con disparador. `email-disparadores.spec.ts` en verde.

## Nivel 3 — El envío

`BrandEmailService.sendTemplate` en orden: existe la plantilla → existe el
negocio → la plantilla no está apagada para la marca → **hay transporte** → hay
destinatario → se interpola → se manda.

Todo es *best-effort*: envuelto en un `try/catch` que nunca propaga. Esto cuelga
de webhooks de pago y del cron. **Un fallo de correo no puede tumbar un cobro.**

## Nivel 4 — El transporte, y la distinción que más se confunde

Son **dos cosas distintas** y conviene no mezclarlas nunca:

- La **firma** —logo, color, «Enviado por X», dominio de los links, correo de
  contacto— sale **siempre de la marca del negocio**. La pone `emailShell` y
  **no depende del transporte**.
- El **remitente** lo pone la subcuenta de Grow Business que transporta.

Cascada del transporte:

1. Subcuenta **propia de la marca**.
2. Si es la **plataforma** o el negocio no tiene marca: cuenta de cobros
   asignada al negocio → subcuenta predeterminada.
3. **Marca blanca sin subcuenta propia: no envía.** Es deliberado. Un remitente
   `@soyclubify.com` en un correo firmado por otra marca delata la plataforma y
   rompe el DMARC de su dominio. Prefiere el silencio al error.

| Marca | Firma | Transporte | Remitente |
|---|---|---|---|
| Sellea | Sellea | subcuenta propia | la de Sellea |
| Clubify | Clubify | predeterminada | `Clubify Oficial <Contacto@soyclubify.lat>` |
| Fideliso | Fideliso | ninguno | no envía |

> **Comprobado:** `verificar-transporte-correo.cjs` contra producción, marca por
> marca, consultando la identidad real de cada subcuenta a la API de GHL.

## Nivel 5 — El canal

`GrowBusinessService.sendEmailWithCreds`: alta o actualización del contacto por
correo, y `POST /conversations/messages` con `type: 'Email'`.

No hay proveedor de correo propio. **En Railway no existe `RESEND_API_KEY`.**

> **Comprobado:** envío real por la subcuenta de Clubify → `201 Email queued
> successfully`. Variables de Railway sin ninguna clave de correo.

## Nivel 6 — El panel

Una automatización = una tarjeta, con su WhatsApp y su correo juntos, asunto y
cuerpo editables, y botón «Probar correo» que renderiza con un negocio real.

**Hueco encontrado:** `email_panel_ready` **no aparece en el panel**. Las
tarjetas se arman recorriendo el catálogo de SMS y colgándoles su gemelo de
correo; ese correo no tiene gemelo de SMS, así que no se puede editar ni probar
desde la interfaz. Se dispara igual — simplemente no es editable.

> **Comprobado:** `EMAIL_TWIN` mapea 16 automatizaciones de SMS a 15 correos
> distintos. Búsqueda de `panel_ready` en el catálogo de SMS → vacío.

## Nivel 7 — Qué cambió en producción

| Antes | Después |
|---|---|
| Sellea: 4 negocios reciben correo | igual |
| Clubify: **74 negocios, 0 correos** | 74 reciben |
| Reembolsos y disputas de Stripe caían en `unhandled` | se manejan y avisan |
| El correo de bienvenida se escribía en el log | sale de verdad |

Un reembolso **no suspendía la cuenta ni avisaba a nadie**. Ese era el más caro
de los defectos, y no era el que se buscaba.

> **Comprobado:** `diag-cobertura-correo.cjs` contra producción.

## Nivel 8 — Los defectos que aparecieron de paso

- El **dedup por ciclo** se marcaba solo si el SMS salía bien. Un negocio sin
  teléfono habría recibido el mismo correo **todos los días**.
- `POST /billing/run-daily-check` repetía el aviso de mora en cada corrida.
- El aviso «hoy renovamos» se perdía para cobros entre 00:00 y 03:00.
- Apagar un correo desde el panel **no funcionaba**, y apagar borraba la clave —
  que para un correo significa volver al default, o sea encendido.
- Los **5 e2e que llevaban meses rojos**: 3 parecían una fuga de datos entre
  negocios y no lo eran (el test llamaba a Prisma con una promesa perezosa que se
  salía del contexto; el aislamiento siempre funcionó), y 2 probaban unos pagos
  públicos eliminados hace tiempo.

## Nivel 9 — Estado verificable hoy

| Qué | Resultado | Cómo |
|---|---|---|
| Tipos backend | 0 errores | `tsc --noEmit` |
| Tipos frontend | 0 errores | `tsc --noEmit` |
| Tests unitarios | **175 pasan, 2 omitidos, 0 fallan** | `vitest run` |
| Tests e2e | 3 archivos no corren **sin base local** (`P2021`) | ídem |
| Rutas en vivo | las 4 responden 401 | `curl`, calibrado con una ruta falsa → 404 |
| Freno de `db push` | aborta contra remoto, deja pasar local | ejecutado con las dos URLs |

Tamaño: **2.039 líneas** en el motor de correo (13 archivos), **2.419** en los
disparadores de cobro (12 archivos).

## Nivel 10 — Lo que NO puedo afirmar

Esto es lo que separa un informe confiable de uno cómodo.

1. **No pude verificar el panel desplegado.** El chunk que confirmé esta mañana
   ya devuelve 404: el frontend se redesplegó desde entonces. `/superadmin` pide
   login, así que desde fuera no veo su contenido. **Si la otra máquina desplegó
   su build, la parte de correo del panel puede no estar arriba.** Se confirma
   entrando al panel y mirando si las tarjetas muestran «WhatsApp · Email».

2. **El fallback de plataforma no está probado *dentro del proceso desplegado*.**
   Probado sí está: el transporte contra GHL (201 real) y la resolución contra
   los datos de producción. Lo que falta es el clic de «Probar correo» sobre una
   marca Clubify, que cierra el circuito en un minuto.

3. **No hay test automático del fallback.** `platformTransport` se comprobó con
   un script contra datos reales, no con un test que corra en CI. Si alguien
   quita el `isDefault` de la subcuenta, **nada avisa**: los 74 negocios de
   Clubify dejan de recibir correo en silencio. Es la deuda más peligrosa que
   queda, porque falla callado.

## Nivel 11 — Riesgos vivos, por gravedad

1. **Falla silenciosa del transporte de plataforma.** Depende de un booleano en
   una fila. Sin test ni alerta. → un test de integración, o al menos un aviso
   en el panel cuando no haya subcuenta predeterminada.
2. **3 negocios usan la conexión general de Clubify como si fuera suya** —
   MOTILART, NudoCowork, Wok Explosivo. Sus mensajes a **sus** clientes salen con
   identidad de Clubify. Decisión de Javier: se corrige después. Plan completo en
   `BITACORA.md`.
3. **Fideliso no envía correo.** Correcto por diseño, pero al primer negocio con
   cobro habrá que vincularle su subcuenta.
4. **`email_panel_ready` no es editable** desde el panel.
5. **La subcuenta de Clubify se llama «Reseñas»** en el panel. El nombre miente y
   ya costó horas de búsqueda.

## Nivel 12 — Lectura de conjunto

Lo que se pidió era «que los mensajes salgan también por correo». Lo que
realmente hacía falta era **una capa de comunicación por marca** que no existía:
un catálogo con disparadores verificados, herencia por marca, un transporte que
respeta la identidad de cada una, y la negativa explícita a enviar cuando no
puede hacerlo bien.

Lo más valioso no fue el correo. Fue lo que apareció al levantar la alfombra: un
reembolso que no avisaba a nadie, una bienvenida que llevaba meses escribiéndose
en un log, y cinco tests en rojo que todos daban por perdidos y que escondían un
susto de aislamiento entre negocios que resultó ser falso.

Lo que queda débil es la **observabilidad**: casi todo el sistema falla en
silencio por diseño —lo cual es correcto, un correo no puede tumbar un cobro—
pero nadie se entera. Hoy la única forma de saber si los correos salen es
ejecutar un script a mano. Ese es el siguiente trabajo que rinde.

---

## Cómo re-verificar todo esto

```bash
cd backend
npx tsc --noEmit -p tsconfig.json
npx vitest run
railway run node scripts/diag-cobertura-correo.cjs        # cobertura por marca
railway run node scripts/verificar-transporte-correo.cjs  # transporte y remitente
railway run node scripts/diag-impacto-quitar-creds.cjs    # creds prestadas
```

Ninguno de esos diagnósticos escribe en la base.
