import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

export async function GET(_req: NextRequest, { params }: { params: { passId: string } }) {
  const upstream = await fetch(`${BACKEND_URL}/api/passes/${params.passId}/apple.pkpass`, {
    cache: 'no-store',
  });

  if (!upstream.ok) {
    return new NextResponse('Pass not available', { status: upstream.status });
  }

  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${params.passId}.pkpass"`,
    },
  });
}
