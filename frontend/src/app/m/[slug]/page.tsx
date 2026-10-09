// Menú público, MESA. El HTML sale ya con el menú: ver `./pagina-del-menu`.
import { paginaDelMenu, type PropsDeLaPagina } from './pagina-del-menu';

export default function Pagina(props: PropsDeLaPagina) {
  return paginaDelMenu('mesa', props);
}
