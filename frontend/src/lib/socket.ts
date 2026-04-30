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
    transports: ['websocket'],
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
