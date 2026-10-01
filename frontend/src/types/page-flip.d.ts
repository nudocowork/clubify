// page-flip (StPageFlip) no publica tipos. Solo se tipa lo que usamos; la
// forma fina vive en el tipo PageFlipInstancia de LibroDeHojas.
declare module 'page-flip' {
  export class PageFlip {
    constructor(el: HTMLElement, settings: Record<string, unknown>);
    loadFromImages(urls: string[]): void;
    loadFromHTML(hojas: NodeListOf<Element> | HTMLElement[]): void;
    flipNext(): void;
    flipPrev(): void;
    flip(n: number): void;
    turnToPage(n: number): void;
    getCurrentPageIndex(): number;
    getPage(n: number): { setDensity(d: 'soft' | 'hard'): void };
    on(ev: string, cb: (e: { data: unknown }) => void): void;
    destroy(): void;
  }
}
