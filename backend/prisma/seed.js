"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const argon2 = __importStar(require("argon2"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Seeding Clubify v2...');
    const freePlan = await prisma.plan.upsert({
        where: { name: 'Free' },
        update: {},
        create: {
            name: 'Free',
            maxLocations: 3,
            maxCards: 2,
            maxCustomers: 200,
            maxProducts: 30,
            maxOrdersMonth: 50,
            pushIncluded: 200,
            whatsappIncluded: 100,
            priceMonthly: 0,
        },
    });
    const proPlan = await prisma.plan.upsert({
        where: { name: 'Pro' },
        update: {
            maxProducts: 100,
            maxOrdersMonth: 500,
            whatsappIncluded: 1000,
        },
        create: {
            name: 'Pro',
            maxLocations: 5,
            maxCards: 10,
            maxCustomers: 5000,
            maxProducts: 100,
            maxOrdersMonth: 500,
            pushIncluded: 5000,
            whatsappIncluded: 1000,
            priceMonthly: 29,
        },
    });
    await prisma.plan.upsert({
        where: { name: 'Business' },
        update: {
            maxProducts: 500,
            maxOrdersMonth: 5000,
            whatsappIncluded: 10000,
        },
        create: {
            name: 'Business',
            maxLocations: 25,
            maxCards: 50,
            maxCustomers: 50000,
            maxProducts: 500,
            maxOrdersMonth: 5000,
            pushIncluded: 50000,
            whatsappIncluded: 10000,
            priceMonthly: 79,
        },
    });
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@clubify.local';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Clubify123!';
    const isProdSeed = !!process.env.SEED_ADMIN_EMAIL;
    if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_EMAIL) {
        console.warn('⚠ ADVERTENCIA: corriendo seed en NODE_ENV=production sin SEED_ADMIN_EMAIL/PASSWORD.\n' +
            '   Vas a quedar con el admin demo (admin@clubify.local / Clubify123!) — CAMBIALO YA en /app/account.');
    }
    const adminHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    await prisma.user.upsert({
        where: { email: adminEmail },
        update: isProdSeed ? { passwordHash: adminHash } : {},
        create: {
            email: adminEmail,
            passwordHash: adminHash,
            fullName: 'Super Admin',
            role: 'SUPER_ADMIN',
        },
    });
    const demoTenant = await prisma.tenant.upsert({
        where: { slug: 'cafe-del-dia' },
        update: {
            whatsappPhone: '+573000000000',
            currency: 'COP',
        },
        create: {
            name: 'Café del Día',
            brandName: 'Café del Día',
            slug: 'cafe-del-dia',
            email: 'demo@clubify.local',
            phone: '+57 300 000 0000',
            whatsappPhone: '+573000000000',
            planId: proPlan.id,
            status: 'ACTIVE',
            primaryColor: '#6366F1',
            secondaryColor: '#C026D3',
            currency: 'COP',
            timezone: 'America/Bogota',
            instagramUrl: 'https://instagram.com/cafedeldia',
        },
    });
    const ownerHash = await argon2.hash('Demo123!', { type: argon2.argon2id });
    await prisma.user.upsert({
        where: { email: 'demo@clubify.local' },
        update: {},
        create: {
            email: 'demo@clubify.local',
            passwordHash: ownerHash,
            fullName: 'Dueño Demo',
            role: 'TENANT_OWNER',
            tenantId: demoTenant.id,
        },
    });
    await prisma.storefront.upsert({
        where: { tenantId: demoTenant.id },
        update: {},
        create: {
            tenantId: demoTenant.id,
            description: 'Café de especialidad en el centro de Bogotá. Granos seleccionados, repostería casera, ambiente para trabajar.',
            theme: { primaryColor: '#6366F1', secondaryColor: '#C026D3' },
            blocks: [
                { type: 'hero' },
                { type: 'social' },
                { type: 'menu' },
                { type: 'cards' },
                { type: 'promotions' },
            ],
            isPublished: true,
        },
    });
    const card = await prisma.card.upsert({
        where: { id: '11111111-1111-1111-1111-111111111111' },
        update: {},
        create: {
            id: '11111111-1111-1111-1111-111111111111',
            tenantId: demoTenant.id,
            type: 'STAMPS',
            name: 'Café del Día — 10 sellos',
            description: 'Compra 10 cafés y el siguiente es gratis',
            terms: 'No acumulable con otras promociones. Válido en todas las sucursales.',
            primaryColor: '#6366F1',
            secondaryColor: '#C026D3',
            stampsRequired: 10,
            rewardText: '1 café gratis',
            autoStampOnOrder: true,
            autoStampAmount: 1,
        },
    });
    const loc = await prisma.location.upsert({
        where: { id: '22222222-2222-2222-2222-222222222222' },
        update: {},
        create: {
            id: '22222222-2222-2222-2222-222222222222',
            tenantId: demoTenant.id,
            name: 'Sede Centro',
            address: 'Cra 7 # 10-20, Bogotá',
            latitude: 4.6097,
            longitude: -74.0817,
            radiusMeters: 300,
        },
    });
    const desayunos = await upsertCategory(demoTenant.id, 'Desayunos', 0);
    const bebidas = await upsertCategory(demoTenant.id, 'Bebidas', 1);
    const postres = await upsertCategory(demoTenant.id, 'Postres', 2);
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: desayunos.id,
        name: 'Calentado paisa',
        description: 'Huevos, frijoles, arepa, chicharrón, chocolate.',
        basePrice: 18000,
        tags: ['popular'],
        variants: [
            { name: 'Personal', priceDelta: 0, isDefault: true },
            { name: 'Grande', priceDelta: 4000 },
        ],
        extras: [
            { name: 'Aguacate', price: 3000 },
            { name: 'Doble huevo', price: 2000 },
        ],
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: desayunos.id,
        name: 'Avena con frutas',
        description: 'Opción saludable, sin azúcar añadida.',
        basePrice: 12000,
        tags: ['nuevo'],
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: desayunos.id,
        name: 'Pancakes de banano',
        description: 'Tres pancakes esponjosos con miel y banano.',
        basePrice: 14000,
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: bebidas.id,
        name: 'Capuchino',
        description: 'Espresso doble, leche vaporizada, espuma artesanal.',
        basePrice: 7500,
        tags: ['popular'],
        variants: [
            { name: '8oz', priceDelta: 0, isDefault: true },
            { name: '12oz', priceDelta: 2000 },
        ],
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: bebidas.id,
        name: 'Latte saborizado',
        basePrice: 9000,
        extras: [
            { name: 'Sirope vainilla', price: 1500 },
            { name: 'Sirope caramelo', price: 1500 },
            { name: 'Leche almendras', price: 2000 },
        ],
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: bebidas.id,
        name: 'Jugo natural',
        description: 'Maracuyá, mora, lulo o piña.',
        basePrice: 8000,
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: postres.id,
        name: 'Brownie con helado',
        description: 'Brownie tibio con bola de vainilla.',
        basePrice: 11000,
        tags: ['popular'],
    });
    await upsertProduct({
        tenantId: demoTenant.id,
        categoryId: postres.id,
        name: 'Cheesecake de fresa',
        basePrice: 12500,
    });
    await prisma.promotion.upsert({
        where: { id: '33333333-3333-3333-3333-333333333333' },
        update: {},
        create: {
            id: '33333333-3333-3333-3333-333333333333',
            tenantId: demoTenant.id,
            name: '20% off en bebidas los lunes',
            description: 'Descuento automático todos los lunes en la categoría bebidas.',
            type: 'DISCOUNT_PCT',
            value: 20,
            conditions: {
                daysOfWeek: [1],
                categoryName: 'Bebidas',
            },
            isActive: true,
        },
    });
    const customer = await prisma.customer.upsert({
        where: { tenantId_phone: { tenantId: demoTenant.id, phone: '+573001112222' } },
        update: {},
        create: {
            tenantId: demoTenant.id,
            fullName: 'María Pérez',
            email: 'maria@example.com',
            phone: '+573001112222',
        },
    });
    const { sign } = await Promise.resolve().then(() => __importStar(require('jsonwebtoken')));
    const passInit = await prisma.pass.upsert({
        where: { cardId_customerId: { cardId: card.id, customerId: customer.id } },
        update: {},
        create: {
            tenantId: demoTenant.id,
            cardId: card.id,
            customerId: customer.id,
            serialNumber: 'CLB-DEMO-001',
            qrToken: 'placeholder',
            authToken: 'demo-auth-token',
            stampsCount: 3,
        },
    });
    const qrToken = sign({ pid: passInit.id, tid: demoTenant.id }, process.env.QR_HMAC_SECRET ?? 'dev-qr', { algorithm: 'HS256' });
    await prisma.pass.update({
        where: { id: passInit.id },
        data: { qrToken },
    });
    await prisma.automationRule.upsert({
        where: { id: '44444444-4444-4444-4444-444444444444' },
        update: {},
        create: {
            id: '44444444-4444-4444-4444-444444444444',
            tenantId: demoTenant.id,
            name: 'Agradecer pedido confirmado',
            description: 'Genera un mensaje de WhatsApp al cliente cuando se confirma su pedido.',
            trigger: { type: 'ORDER_CONFIRMED' },
            conditions: [],
            actions: [
                {
                    type: 'SEND_WHATSAPP_LINK',
                    body: '¡Gracias {{nombre}}! Tu pedido #{{order_code}} está confirmado. Te avisamos cuando esté listo. 🙌',
                },
            ],
            isActive: true,
        },
    });
    await prisma.referralCode.upsert({
        where: { code: 'DEMO2025' },
        update: {},
        create: {
            code: 'DEMO2025',
            ownerName: 'Partner Demo',
            ownerEmail: 'partner@example.com',
            ownerWhatsapp: '+57 300 999 0000',
            commissionPercent: 25,
        },
    });
    await prisma.infoLink.upsert({
        where: { tenantId_slug: { tenantId: demoTenant.id, slug: 'eventos-mayo' } },
        update: {},
        create: {
            tenantId: demoTenant.id,
            slug: 'eventos-mayo',
            title: 'Eventos de Mayo en Café del Día',
            subtitle: 'Catas, talleres y noches temáticas. Reserva tu cupo por WhatsApp.',
            heroImageUrl: null,
            gallery: [],
            sections: [
                { type: 'paragraph', text: 'Este mes traemos una agenda especial: cata de cafés de origen, taller de latte art, y una noche temática boleros. Cupos limitados.' },
                { type: 'heading', text: '🌱 Cata de cafés de origen' },
                { type: 'paragraph', text: 'Sábado 11 de mayo · 10am · $25.000 con degustación incluida.' },
                { type: 'divider' },
                { type: 'heading', text: '🎨 Taller de latte art' },
                { type: 'paragraph', text: 'Domingo 19 de mayo · 9am · $40.000 incluye desayuno y diploma.' },
                { type: 'divider' },
                { type: 'heading', text: '🎶 Noche de boleros' },
                { type: 'paragraph', text: 'Viernes 31 de mayo · 8pm · entrada libre, consumo mínimo $30.000.' },
                { type: 'embed_promotions' },
                { type: 'embed_menu' },
            ],
            buttons: [
                { label: 'Reservar por WhatsApp', type: 'WHATSAPP', style: 'primary' },
                { label: 'Ver menú completo', type: 'MENU', style: 'secondary' },
                { label: 'Cómo llegar', type: 'MAPS', style: 'secondary' },
            ],
            theme: { primaryColor: '#6366F1' },
            isActive: true,
        },
    });
    console.log('✅ Seed completo');
    console.log(`   Super Admin: ${adminEmail} / ${isProdSeed ? '<oculto>' : adminPassword}`);
    console.log('   Tenant demo: demo@clubify.local / Demo123!');
    console.log(`   Storefront público: /m/cafe-del-dia`);
    console.log(`   Info link demo: /i/cafe-del-dia/eventos-mayo`);
    console.log(`   Pase demo: ${passInit.id}`);
}
async function upsertCategory(tenantId, name, position) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await prisma.category.findFirst({
        where: { tenantId, slug, parentId: null },
    });
    if (existing)
        return existing;
    return prisma.category.create({
        data: { tenantId, name, slug, position, isActive: true },
    });
}
async function upsertProduct(opts) {
    const existing = await prisma.product.findFirst({
        where: { tenantId: opts.tenantId, name: opts.name },
    });
    if (existing)
        return existing;
    return prisma.product.create({
        data: {
            tenantId: opts.tenantId,
            categoryId: opts.categoryId,
            name: opts.name,
            description: opts.description ?? '',
            basePrice: opts.basePrice,
            imageUrl: opts.imageUrl,
            tags: opts.tags ?? [],
            variants: opts.variants
                ? {
                    create: opts.variants.map((v, i) => ({
                        groupName: 'Tamaño',
                        name: v.name,
                        priceDelta: v.priceDelta,
                        isDefault: v.isDefault ?? false,
                        position: i,
                    })),
                }
                : undefined,
            extras: opts.extras
                ? {
                    create: opts.extras.map((e) => ({
                        name: e.name,
                        price: e.price,
                        maxQty: e.maxQty ?? 1,
                    })),
                }
                : undefined,
        },
    });
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map