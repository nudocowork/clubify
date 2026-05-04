import { notFound } from 'next/navigation';
import { WalletPassView } from './WalletPassView';

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

async function fetchPassData(passId: string) {
  const res = await fetch(`${BACKEND_URL}/api/passes/${passId}/public`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function fetchGoogleSaveUrl(passId: string) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/passes/${passId}/google`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.saveUrl === 'string' ? j.saveUrl : null;
  } catch {
    return null;
  }
}

export default async function WalletPage({ params }: { params: { passId: string } }) {
  const data = await fetchPassData(params.passId);
  if (!data) notFound();
  const googleSaveUrl = await fetchGoogleSaveUrl(params.passId);

  return (
    <WalletPassView
      passId={params.passId}
      data={data}
      googleSaveUrl={googleSaveUrl}
    />
  );
}
