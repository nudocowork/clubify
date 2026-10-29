import { redirect } from 'next/navigation';

// Había dos textos de términos que se contradecían. Queda uno solo en
// /legal/terms; los enlaces viejos (registro de afiliado, prueba gratis)
// caen en su sección de afiliados.
export default function TerminosPage() {
  redirect('/legal/terms#afiliados');
}
