/**
 * El primer teléfono UTILIZABLE de una cadena de candidatos, o null.
 *
 * Por qué existe: las cadenas de destino del pedido (`sede → pedidos del
 * negocio → WhatsApp → teléfono → dueño`) se armaban con `??`, que solo salta
 * `null` y `undefined`. Un campo borrado desde Ajustes se guardaba como `''`, y
 * al llegar ahí la cadena se paraba: La Gloriosa tenía `whatsappPhone = ''` y
 * los pedidos de su sede sin número propio no le llegaban a nadie — ni el SMS
 * del servidor ni el enlace de WhatsApp. En producción había 9 negocios así.
 *
 * «Utilizable» = tras `trim()` queda algo con al menos un dígito. Lo de los
 * dígitos es a propósito: un valor como «-» o «N/A» no marca a nadie, y
 * pararse en él es el mismo fallo que pararse en `''`.
 *
 * Devuelve el valor recortado pero SIN normalizar: cada llamador decide si lo
 * quiere en dígitos (wa.me) o tal cual (el SMS, que lo normaliza por su lado).
 */
export function primerTelefono(
  ...candidatos: Array<string | null | undefined>
): string | null {
  for (const c of candidatos) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (/\d/.test(t)) return t;
  }
  return null;
}
