'use client';

/**
 * /admin/sales-leaderboard — rankings globales del CRM (C8).
 * Solo super admin. Muestra top usuarios y top equipos por
 * totalContacts / clientCount / conversionRate.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type UserRanking = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  totalContacts: number;
  clientCount: number;
  conversionRate: number;
};

type TeamRanking = {
  teamId: string;
  name: string;
  memberCount: number;
  totalContacts: number;
  clientCount: number;
  conversionRate: number;
};

type Sort = 'contacts' | 'clients' | 'conversion';

export default function SalesLeaderboardPage() {
  const t = useTranslations('admin_sales_leaderboard');
  const [users, setUsers] = useState<UserRanking[] | null>(null);
  const [teams, setTeams] = useState<TeamRanking[] | null>(null);
  const [userSort, setUserSort] = useState<Sort>('contacts');
  const [teamSort, setTeamSort] = useState<Sort>('contacts');

  async function load() {
    try {
      const r = await api<{
        users: UserRanking[];
        teams: TeamRanking[];
      }>('/admin/sales-teams/leaderboard');
      setUsers(r.users);
      setTeams(r.teams);
    } catch (e: any) {
      toast(e?.message || t('errLoading'), 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!users || !teams) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="h-64 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  const sortedUsers = sortRanking(users, userSort);
  const sortedTeams = sortRanking(teams, teamSort);

  return (
    <div className="max-w-5xl">
      <div className="page-head">
        <h1 className="page-title">{t('title')}</h1>
        <Link href="/admin/sales-teams" className="btn-ghost text-sm">
          {t('backToTeams')}
        </Link>
      </div>

      <p className="text-mute text-sm mb-4 max-w-prose">{t('intro')}</p>

      <h2 className="font-semibold text-base mt-6 mb-3">{t('topAffiliates')}</h2>
      <SortTabs current={userSort} onChange={setUserSort} />
      <div className="card overflow-x-auto mt-2">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-mute">
            <tr className="border-b border-line">
              <th className="text-left px-2 sm:px-3 py-2 w-8 sm:w-10">#</th>
              <th className="text-left px-2 sm:px-3 py-2">{t('colAffiliate')}</th>
              {/* "Rol" ocupa mucho en mobile y los AFFILIATE_X son largos —
                  lo ocultamos < sm y volvemos a mostrarlo en tablet+. */}
              <th className="hidden sm:table-cell text-left px-3 py-2">{t('colRole')}</th>
              <th className="text-right px-2 sm:px-3 py-2">{t('colContacts')}</th>
              {/* Clientes y Conversión se ven mejor con headers cortos en
                  pantallas muy chicas para no romper el wrap. */}
              <th className="text-right px-2 sm:px-3 py-2">
                <span className="sm:hidden">{t('colClientsShort')}</span>
                <span className="hidden sm:inline">{t('colClients')}</span>
              </th>
              <th className="text-right px-2 sm:px-3 py-2">
                <span className="sm:hidden">{t('colConversionShort')}</span>
                <span className="hidden sm:inline">{t('colConversion')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-mute italic">
                  {t('emptyAffiliates')}
                </td>
              </tr>
            )}
            {sortedUsers.map((u, idx) => (
              <tr key={u.userId} className="border-b border-line hover:bg-bg2/30">
                <td className="px-2 sm:px-3 py-2 text-mute">{idx + 1}</td>
                <td className="px-2 sm:px-3 py-2">
                  <div className="font-medium leading-tight">{u.fullName}</div>
                  <div className="text-[11px] text-mute truncate max-w-[160px] sm:max-w-none">
                    {u.email}
                  </div>
                </td>
                <td className="hidden sm:table-cell px-3 py-2 text-xs">
                  {u.role.replace('AFFILIATE_', '')}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right font-semibold">
                  {u.totalContacts}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right text-ok-ink font-semibold">
                  {u.clientCount}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right">{u.conversionRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-semibold text-base mt-8 mb-3">{t('topTeams')}</h2>
      <SortTabs current={teamSort} onChange={setTeamSort} />
      <div className="card overflow-x-auto mt-2">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-mute">
            <tr className="border-b border-line">
              <th className="text-left px-2 sm:px-3 py-2 w-8 sm:w-10">#</th>
              <th className="text-left px-2 sm:px-3 py-2">{t('colTeam')}</th>
              {/* "Miembros" se oculta < sm para dejar espacio a las
                  columnas de números. */}
              <th className="hidden sm:table-cell text-right px-3 py-2">{t('colMembers')}</th>
              <th className="text-right px-2 sm:px-3 py-2">{t('colContacts')}</th>
              <th className="text-right px-2 sm:px-3 py-2">
                <span className="sm:hidden">{t('colClientsShort')}</span>
                <span className="hidden sm:inline">{t('colClients')}</span>
              </th>
              <th className="text-right px-2 sm:px-3 py-2">
                <span className="sm:hidden">{t('colConversionShort')}</span>
                <span className="hidden sm:inline">{t('colConversion')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTeams.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-mute italic">
                  {t('emptyTeams')}
                </td>
              </tr>
            )}
            {sortedTeams.map((team, idx) => (
              <tr key={team.teamId} className="border-b border-line hover:bg-bg2/30">
                <td className="px-2 sm:px-3 py-2 text-mute">{idx + 1}</td>
                <td className="px-2 sm:px-3 py-2 font-medium">{team.name}</td>
                <td className="hidden sm:table-cell px-3 py-2 text-right text-xs">
                  {team.memberCount}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right font-semibold">
                  {team.totalContacts}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right text-ok-ink font-semibold">
                  {team.clientCount}
                </td>
                <td className="px-2 sm:px-3 py-2 text-right">{team.conversionRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sortRanking<T extends { totalContacts: number; clientCount: number; conversionRate: number }>(
  arr: T[],
  by: Sort,
): T[] {
  const copy = [...arr];
  switch (by) {
    case 'clients':
      return copy.sort((a, b) => b.clientCount - a.clientCount);
    case 'conversion':
      return copy.sort((a, b) => b.conversionRate - a.conversionRate);
    case 'contacts':
    default:
      return copy.sort((a, b) => b.totalContacts - a.totalContacts);
  }
}

function SortTabs({
  current,
  onChange,
}: {
  current: Sort;
  onChange: (s: Sort) => void;
}) {
  const t = useTranslations('admin_sales_leaderboard');
  const OPTIONS: { id: Sort; labelKey: string }[] = [
    { id: 'contacts', labelKey: 'sortByContacts' },
    { id: 'clients', labelKey: 'sortByClients' },
    { id: 'conversion', labelKey: 'sortByConversion' },
  ];
  return (
    <div className="flex gap-1.5">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
            current === o.id
              ? 'border-ink text-ink bg-white'
              : 'border-line text-mute hover:text-ink'
          }`}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  );
}
