// /m/[slug]/[sectionSlug] — deep-link a una sección del menú MESA.
import { paginaDelMenu, type PropsDeLaPagina } from '../pagina-del-menu';

export default function Pagina(props: PropsDeLaPagina) {
  return paginaDelMenu('mesa', props);
}
