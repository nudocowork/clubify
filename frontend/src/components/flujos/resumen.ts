// El resumen de la tarjeta de un paso a partir de la plantilla del catálogo.
//
// Existe para que la pantalla siga sin un `if` por tipo de paso: el backend
// dice «Espera respuesta · {amount} {unit}» y aquí solo se rellenan huecos.

type CampoParaResumen = {
  key: string;
  tipo: string;
  def?: string | number;
  opciones?: { value: string; label: string; singular?: string }[];
};

/**
 * Campos que dependen de OTRO campo del mismo paso.
 *
 * Nació con «Enviar correo»: al elegir una plantilla, el cuerpo escrito en el
 * paso deja de mandarse y el asunto deja de ser obligatorio (cae al de la
 * plantilla). Se resuelve con dos banderas genéricas del catálogo en vez de con
 * un `if` por tipo de paso, que es lo que estas pantallas llevan años evitando.
 */
type CampoCondicionado = { key: string; requerido?: boolean; ocultoSi?: string; requeridoSalvo?: string };

const tieneValor = (config: Record<string, any> | undefined, clave: string | undefined) =>
  !!clave && String(config?.[clave] ?? '').trim() !== '';

/** ¿Este campo se pinta, o lo tapa otro que ya está relleno? */
export function campoVisible(campo: CampoCondicionado, config: Record<string, any> | undefined): boolean {
  return !tieneValor(config, campo.ocultoSi);
}

/**
 * ¿Falta rellenarlo AHORA MISMO? Un campo oculto nunca falta: marcar en rojo
 * algo que la pantalla no enseña es la peor forma de decir «te falta algo».
 */
export function campoObligatorio(campo: CampoCondicionado, config: Record<string, any> | undefined): boolean {
  if (!campo.requerido) return false;
  if (!campoVisible(campo, config)) return false;
  return !tieneValor(config, campo.requeridoSalvo);
}

/**
 * Rellena `{clave}` con el valor del campo (el texto de la opción en los
 * desplegables, o su valor por defecto si el paso no lo trae).
 *
 * Una opción con `singular` lo usa cuando el número que la precede es 1:
 * «1 día», no «1 días». Los huecos se rellenan de izquierda a derecha, así
 * que «el número que la precede» es el último número ya escrito.
 */
export function aplicarPlantilla(plantilla: string, campos: CampoParaResumen[], config: Record<string, unknown> | undefined): string {
  // Si algún número de la plantilla no es positivo, el motor ignora el paso
  // entero y usa SUS valores por defecto (`msDeEsperaDeRespuesta`: con 0, tres
  // días). La tarjeta tiene que decir lo mismo que va a pasar, no «0 días».
  const numeroInvalido = campos.some(
    (c) =>
      c.tipo === 'numero' &&
      plantilla.includes(`{${c.key}}`) &&
      !(Number(config?.[c.key] ?? c.def) > 0),
  );
  if (numeroInvalido) config = undefined;
  let ultimoNumero: number | null = null;
  return plantilla.replace(/\{(\w+)\}/g, (_m, clave: string) => {
    const campo = campos.find((c) => c.key === clave);
    const crudo = config?.[clave] ?? campo?.def ?? '';
    if (campo?.tipo === 'select') {
      const op = campo.opciones?.find((o) => o.value === String(crudo));
      if (!op) return String(crudo);
      return ultimoNumero === 1 && op.singular ? op.singular : op.label;
    }
    if (campo?.tipo === 'numero') ultimoNumero = Number(crudo);
    return String(crudo);
  });
}
