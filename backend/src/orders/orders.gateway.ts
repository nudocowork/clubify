import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/ws/orders',
  cors: { origin: true, credentials: true },
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private jwt: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.query?.token as string | undefined) ??
        (client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') as
          | string
          | undefined);
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload: any = this.jwt.verify(token);
      const tenantId = payload?.tenantId;
      const role = payload?.role;
      if (!tenantId || !['TENANT_OWNER', 'TENANT_STAFF'].includes(role)) {
        client.disconnect(true);
        return;
      }
      client.data.tenantId = tenantId;
      client.data.userId = payload.sub;
      client.join(`tenant:${tenantId}`);
      this.logger.log(`socket connected user=${payload.sub} tenant=${tenantId}`);
    } catch (e) {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data?.userId) {
      this.logger.log(`socket disconnected user=${client.data.userId}`);
    }
  }

  /** Notifica a todos los sockets del tenant que un pedido cambió. */
  broadcastOrderUpsert(tenantId: string, order: any) {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('order:upsert', order);
  }

  broadcastOrderDelete(tenantId: string, orderId: string) {
    if (!this.server) return;
    this.server.to(`tenant:${tenantId}`).emit('order:delete', { id: orderId });
  }
}
