// /m/[slug]/[sectionSlug]/[subSlug] — deep-link a una subsección MESA.
import { paginaDelMenu, type PropsDeLaPagina } from '../../pagina-del-menu';

export default function Pagina(props: PropsDeLaPagina) {
  return paginaDelMenu('mesa', props);
}
