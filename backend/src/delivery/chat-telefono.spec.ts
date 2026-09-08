/**
 * El chat del domicilio pide el teléfono, no solo el código.
 *
 * NO necesita base de datos.
 *
 * Por qué. El código del pedido se le enseña al cliente y se pinta en su
 * pantalla: no es un secreto. Con cuatro caracteres se acertaba uno cada 1.808
 * intentos, y quien acertaba podía **escribirle al negocio haciéndose pasar por
 * el cliente** —con su nombre— y leer la conversación privada. El negocio no
 * tenía forma de notarlo (P0-4).
 *
 * Subir el código a seis caracteres lo hace mil veces más difícil, pero no
 * arregla el fondo: la llave era la equivocada. El teléfono sí lo sabe el
 * cliente y no lo sabe quien va probando códigos, porque la respuesta pública
 * del pedido dejó de devolverlo al cerrar P0-3.
 */
import { describe, it, expect, vi } from 'vitest';
import { DeliveryService } from './delivery.service';

const TELEFONO_DEL_PEDIDO = '+57 315 062 1706';

function prismaFalso() {
  const mensajes: any[] = [];
  return {
    mensajes,
    order: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.code === 'ABC123'
          ? { id: 'o1', customer: { fullName: 'Ana Pérez', phone: TELEFONO_DEL_PEDIDO } }
          : null,
      ),
    },
    deliveryMessage: {
      create: vi.fn(async ({ data }: any) => {
        mensajes.push(data);
        return data;
      }),
      findMany: vi.fn(async () => mensajes),
    },
  };
}

function servicio(prisma: any) {
  const svc = Object.create(DeliveryService.prototype) as any;
  svc.prisma = prisma;
  svc.chatList = vi.fn(async () => prisma.mensajes);
  svc.cleanBody = (b: string) => b.trim();
  return svc as DeliveryService;
}

describe('escribir en el chat', () => {
  it('con el telefono del pedido, escribe', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    await svc.customerChatPost('ABC123', 'Hola, ¿falta mucho?', '3150621706');
    expect(prisma.mensajes).toHaveLength(1);
    expect(prisma.mensajes[0].senderRole).toBe('CUSTOMER');
    expect(prisma.mensajes[0].senderName).toBe('Ana Pérez');
  });

  it('SIN telefono no escribe, aunque el codigo sea bueno', async () => {
    // Este es el ataque: acertar el codigo y hablar como el cliente.
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    await expect(svc.customerChatPost('ABC123', 'Cámbiame la dirección', '')).rejects.toThrow();
    expect(prisma.mensajes).toHaveLength(0);
  });

  it('con OTRO telefono tampoco', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    await expect(
      svc.customerChatPost('ABC123', 'Ya pagué por transferencia', '3009998877'),
    ).rejects.toThrow();
    expect(prisma.mensajes).toHaveLength(0);
  });

  it('con un TROZO del telefono tampoco: se compara la cola entera', async () => {
    // Conocer parte del numero no puede bastar. Mismo criterio que «mis
    // pedidos», donde 7 digitos ya listaban pedidos ajenos.
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    await expect(svc.customerChatPost('ABC123', 'hola', '3150621')).rejects.toThrow();
    await expect(svc.customerChatPost('ABC123', 'hola', '0621706')).rejects.toThrow();
    expect(prisma.mensajes).toHaveLength(0);
  });

  it('acepta el numero con o sin prefijo y con espacios', async () => {
    // El cliente escribe como quiera; lo que se compara son los digitos.
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    await svc.customerChatPost('ABC123', 'uno', '315 062 1706');
    await svc.customerChatPost('ABC123', 'dos', '+573150621706');
    expect(prisma.mensajes).toHaveLength(2);
  });
});

describe('leer la conversacion', () => {
  it('tambien pide el telefono: ahi esta lo que le escribio el negocio', async () => {
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    await expect(svc.customerChatList('ABC123', '')).rejects.toThrow();
    await expect(svc.customerChatList('ABC123', '3150621706')).resolves.toBeDefined();
  });
});

describe('no delatar que codigos existen', () => {
  it('el mismo error si el codigo no existe que si el telefono no casa', async () => {
    // Si los mensajes fueran distintos, probar codigos hasta que cambie de
    // «no existe» a «telefono incorrecto» seria media faena hecha.
    const prisma = prismaFalso();
    const svc = servicio(prisma) as any;

    const inexistente = await svc.customerChatList('ZZZZZZ', '3150621706').catch((e: Error) => e);
    const telMalo = await svc.customerChatList('ABC123', '3009998877').catch((e: Error) => e);

    expect((inexistente as Error).message).toBe((telMalo as Error).message);
  });
});
