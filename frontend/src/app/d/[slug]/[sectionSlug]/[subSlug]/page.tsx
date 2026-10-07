// /d/[slug]/[sectionSlug]/[subSlug] — deep-link a una subsección DELIVERY.
import { paginaDelMenu, type PropsDeLaPagina } from '../../../../m/[slug]/pagina-del-menu';

export default function Pagina(props: PropsDeLaPagina) {
  return paginaDelMenu('delivery', props);
}
