// /d/[slug] — menú público DELIVERY. Comparte componente con /m/[slug].
import { paginaDelMenu, type PropsDeLaPagina } from '../../m/[slug]/pagina-del-menu';

export default function Pagina(props: PropsDeLaPagina) {
  return paginaDelMenu('delivery', props);
}
