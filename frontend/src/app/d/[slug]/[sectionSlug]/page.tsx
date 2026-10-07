// /d/[slug]/[sectionSlug] — deep-link a una sección del menú DELIVERY.
import { paginaDelMenu, type PropsDeLaPagina } from '../../../m/[slug]/pagina-del-menu';

export default function Pagina(props: PropsDeLaPagina) {
  return paginaDelMenu('delivery', props);
}
