import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

let app: INestApplication;
let token: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('smoke', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/auth/login with seed user returns accessToken', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'demo@clubify.local', password: 'Demo123!' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe('TENANT_OWNER');
    token = res.body.accessToken;
  });

  it('GET /api/auth/me returns the logged-in user', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('demo@clubify.local');
  });

  it('GET /api/public/m/:slug/menu returns categories with products', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/public/m/cafe-del-dia/menu',
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].products.length).toBeGreaterThan(0);
  });

  it('POST /api/public/orders creates an order and returns wa.me link', async () => {
    const menu = await request(app.getHttpServer()).get(
      '/api/public/m/cafe-del-dia/menu',
    );
    const productId = menu.body[0].products[0].id;
    const res = await request(app.getHttpServer())
      .post('/api/public/orders')
      .send({
        tenantSlug: 'cafe-del-dia',
        customer: {
          fullName: 'Smoke Test',
          phone: '+57 999 111 0000',
        },
        items: [{ productId, qty: 1 }],
        fulfillment: 'PICKUP',
      });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(res.body.whatsappLink).toContain('wa.me');
  });

  it('GET /api/orders/board returns 5 status columns', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/board')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'CANCELLED',
      'CONFIRMED',
      'DELIVERED',
      'PENDING',
      'READY',
    ]);
  });

  it('GET /api/info-links returns the seeded info link', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/info-links')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].slug).toBeTruthy();
  });

  it('GET /api/public/i/:slug/:linkSlug returns public info link', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/public/i/cafe-del-dia/eventos-mayo',
    );
    expect(res.status).toBe(200);
    expect(res.body.tenant?.slug).toBe('cafe-del-dia');
    expect(res.body.link?.title).toBeTruthy();
    expect(Array.isArray(res.body.link?.sections)).toBe(true);
  });

  it('GET /api/metrics/tenant returns KPIs object', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/metrics/tenant')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.cards).toBe('number');
    expect(typeof res.body.customers).toBe('number');
  });

  it('GET /api/tenants/me/staff returns staff list (>=1)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/tenants/me/staff')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].email).toBe('demo@clubify.local');
  });

  it('GET /api/metrics/funnel/orders returns 4 stages', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/metrics/funnel/orders')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stages).toHaveLength(4);
    expect(res.body.stages[0].pct).toBe(100);
  });

  it('GET /api/metrics/funnel/loyalty returns 5 stages', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/metrics/funnel/loyalty')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stages).toHaveLength(5);
  });

  it('GET /api/metrics/timeseries/orders returns 30 days', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/metrics/timeseries/orders?days=30')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(30);
    expect(typeof res.body.series[0].count).toBe('number');
  });

  it('GET /api/metrics/heatmap/orders returns 7×24 grid', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/metrics/heatmap/orders')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.cells).toHaveLength(7);
    expect(res.body.cells[0]).toHaveLength(24);
  });

  it('GET /api/public/payments/methods returns at least CASH + STUB', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/public/payments/methods',
    );
    expect(res.status).toBe(200);
    const methods = res.body.map((m: any) => m.method);
    expect(methods).toContain('CASH_ON_DELIVERY');
    expect(methods).toContain('STUB');
    const cash = res.body.find((m: any) => m.method === 'CASH_ON_DELIVERY');
    expect(cash.ready).toBe(true);
  });

  it('payment flow: create order → start STUB pay → confirm → marks PAID', async () => {
    const menu = await request(app.getHttpServer()).get(
      '/api/public/m/cafe-del-dia/menu',
    );
    const productId = menu.body[0].products[0].id;
    const order = await request(app.getHttpServer())
      .post('/api/public/orders')
      .send({
        tenantSlug: 'cafe-del-dia',
        customer: { fullName: 'Pay Test', phone: '+57 999 555 1234' },
        items: [{ productId, qty: 1 }],
        fulfillment: 'PICKUP',
      });
    expect(order.status).toBe(201);

    const pay = await request(app.getHttpServer())
      .post(`/api/public/payments/start/${order.body.code}`)
      .send({ method: 'STUB' });
    expect(pay.status).toBe(201);
    expect(pay.body.paymentUrl).toContain(`/pay/${order.body.code}`);
    expect(pay.body.reference).toMatch(/^STUB-[A-F0-9]+$/);

    const confirm = await request(app.getHttpServer())
      .post(`/api/public/payments/stub/confirm/${order.body.code}`)
      .send({ reference: pay.body.reference, outcome: 'success' });
    expect(confirm.status).toBe(201);
    expect(confirm.body.paymentStatus).toBe('PAID');

    const fetched = await request(app.getHttpServer()).get(
      `/api/public/orders/${order.body.code}`,
    );
    expect(fetched.body.paymentStatus).toBe('PAID');
    expect(fetched.body.paidAt).toBeTruthy();
  });

  it('GET /api/public/storefront/resolve-host returns null for unknown', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/public/storefront/resolve-host?host=unknown-domain.test',
    );
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(null);
  });

  it('storefront customDomain round-trip: PATCH then resolve-host returns slug', async () => {
    const setDomain = await request(app.getHttpServer())
      .patch('/api/storefront')
      .set('Authorization', `Bearer ${token}`)
      .send({ customDomain: 'cafedeldia.test' });
    expect(setDomain.status).toBe(200);
    expect(setDomain.body.customDomain).toBe('cafedeldia.test');

    const resolved = await request(app.getHttpServer()).get(
      '/api/public/storefront/resolve-host?host=cafedeldia.test',
    );
    expect(resolved.body.slug).toBe('cafe-del-dia');

    // limpiar
    await request(app.getHttpServer())
      .patch('/api/storefront')
      .set('Authorization', `Bearer ${token}`)
      .send({ customDomain: null });
  });
});
