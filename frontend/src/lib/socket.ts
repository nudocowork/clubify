'use client';
import { io, Socket } from 'socket.io-client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

function getToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

let ordersSocket: Socket | null = null;

export function getOrdersSocket(): Socket {
  if (ordersSocket && ordersSocket.connected) return ordersSocket;
  if (ordersSocket) return ordersSocket; // reconnecting
  const token = getToken();
  ordersSocket = io(`${API}/ws/orders`, {
    // websocket primero —es el que da el aviso instantáneo— pero con POLLING de
    // respaldo. Con solo websocket, cualquier red que los bloquee (VPN, wifi de
    // centro comercial, proxy corporativo) dejaba el tablero en «Sin conexión»:
    // los pedidos nuevos tardaban hasta 30 s en aparecer —lo que tarda la
    // recarga de reserva— y la campana no sonaba al entrar el pedido. En un
    // restaurante en hora punta, eso es un pedido que nadie ve.
    // Caso real: La Gloriosa, 06-09, con VPN activa en el navegador.
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return ordersSocket;
}

export function disposeOrdersSocket() {
  if (ordersSocket) {
    ordersSocket.disconnect();
    ordersSocket = null;
  }
}
