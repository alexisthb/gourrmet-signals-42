import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Fingerprint, ExternalLink, Check, Loader2, Ban, History, Search, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { ScoreStars } from '@/components/ScoreStars';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import {
  usePendingIdentifications,
  useResolveCompanyIdentity,
  type IdentificationCandidate,
  type PendingIdentification,
} from '@/hooks/useCompanyIdentifications';
import type { SignalType } from '@/types/database';

/**
 * « À identifier » — la machine montre ses candidates, l'humain tranche.
 *
 * Un signal atterrit ici quand la résolution LinkedIn a ABOUTI sans vainqueur
 * (hésitation entre pages proches, ou aucun candidat assez sûr). Réessayer ne
 * change rien — même requête, même hésitation, un run payé en plus. Un clic
 * ici épingle la bonne page : l'enrichissement repart aussitôt, sans cooldown,
 * et l'épinglage prime ensuite sur toute recherche fournisseur — y compris
 * pour les futurs signaux de la même entreprise.
 */

/**
 * Ramène une adresse collée à la forme canonique d'une PAGE ENTREPRISE.
 *
 * Clotilde copie ce que LinkedIn lui donne : parfois `fr.linkedin.com`,
 * souvent une adresse traînant `?originalSubdomain=fr` ou un slash final, et
 * de temps en temps sans le `https://`. Refuser ces variantes serait lui
 * reprocher un copier-coller normal. On normalise donc — même forme que celle
 * déjà stockée par la résolution automatique, sans quoi la mémoire des
 * identités ne se reconnaîtrait pas d'un signal à l'autre.
 *
 * Rend null si ce n'est pas une page entreprise : un profil personnel
 * (/in/...) ou un site web produirait un échec incompréhensible deux étages
 * plus loin, au moment du scrape des employés.
 */
export function normalizeLinkedInCompanyUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const segment = url.pathname.match(/^\/company\/([^/]+)/i);
  if (!segment) return null;
  return `https://www.linkedin.com/company/${segment[1]}`;
}

function humanReason(row: PendingIdentification): string {
  if (row.resolution_status === 'ambiguous') {
    return 'L\'outil hésite entre plusieurs pages LinkedIn trop proches pour trancher seul.';
  }
  if (row.resolution_reason === 'no_candidate' || row.resolution_reason === 'no_candidate_with_company_url') {
    return 'La recherche LinkedIn n\'a renvoyé aucune page exploitable pour ce nom.';
  }
  return 'Aucune page trouvée ne ressemble assez au nom de l\'entreprise pour être retenue sans vous.';
}

// La page épinglée par le passé (autre signal, même entreprise) est proposée
// comme une candidate de plus — en tête, marquée « déjà retenue ».
function buildChoices(row: PendingIdentification): Array<IdentificationCandidate & { fromMemory: boolean }> {
  const candidates = (row.candidates || []).map((c) => ({
    ...c,
    fromMemory: !!row.previously_resolved_url && c.linkedin_url === row.previously_resolved_url,
  }));
  if (row.previously_resolved_url && !candidates.some((c) => c.fromMemory)) {
    candidates.unshift({
      name: row.previously_resolved_name || row.company_name,
      linkedin_url: row.previously_resolved_url,
      score: 100,
      evidence: [],
      fromMemory: true,
    });
  }
  return candidates.sort((a, b) => Number(b.fromMemory) - Number(a.fromMemory));
}

export default function CompanyIdentifications() {
  const { data: pending, isLoading } = usePendingIdentifications();
  const resolveIdentity = useResolveCompanyIdentity();
  // Un seul geste à la fois, et le spinner sur LA candidate cliquée.
  const [inFlight, setInFlight] = useState<{ signalId: string; url: string | null } | null>(null);
  // Adresse saisie à la main, par signal : c'est la seule issue quand l'outil
  // n'a proposé aucune candidate (signalé par Clotilde le 04/09).
  const [manualUrls, setManualUrls] = useState<Record<string, string>>({});

  const pin = async (row: PendingIdentification, url: string, name: string | null) => {
    if (resolveIdentity.isPending) return;
    setInFlight({ signalId: row.signal_id, url });
    try {
      const result = await resolveIdentity.mutateAsync({
        signalId: row.signal_id,
        decision: 'pinned',
        linkedinUrl: url,
        chosenName: name ?? undefined,
      });
      if (result.relaunch?.state === 'authorized') {
        toast.success(`${row.company_name} : identité épinglée, l'enrichissement repart immédiatement.`);
      } else {
        toast.success(
          `${row.company_name} : identité épinglée. Un enrichissement est déjà en cours — votre choix s'appliquera à la prochaine relance.`,
        );
      }
    } catch {
      // Toast d'erreur déjà géré par le hook (onMutationError).
    } finally {
      setInFlight(null);
    }
  };

  const pinManual = async (row: PendingIdentification) => {
    const normalized = normalizeLinkedInCompanyUrl(manualUrls[row.signal_id] || '');
    if (!normalized) {
      toast.error(
        'Adresse non reconnue : il faut la page ENTREPRISE LinkedIn, du type ' +
        'https://www.linkedin.com/company/nom-entreprise (et non un profil de personne).',
      );
      return;
    }
    await pin(row, normalized, null);
    setManualUrls((previous) => ({ ...previous, [row.signal_id]: '' }));
  };

  const rejectAll = async (row: PendingIdentification) => {
    if (resolveIdentity.isPending) return;
    if (!window.confirm(
      `Marquer « ${row.company_name} » comme non identifiable ?\n\n` +
      'La fiche sortira de cette liste, passera en « Ignoré » et l\'outil ne ' +
      'proposera plus de réessai pour elle.',
    )) return;
    setInFlight({ signalId: row.signal_id, url: null });
    try {
      const result = await resolveIdentity.mutateAsync({
        signalId: row.signal_id,
        decision: 'none_of_these',
      });
      toast.success(
        result.archive
          ? `${row.company_name} : fiche classée en « Ignoré ».`
          // Signal déjà travaillé : la décision est consignée, mais on ne
          // rétrograde pas un statut commercial acquis.
          : `${row.company_name} : décision enregistrée. Le statut du signal est conservé, il a déjà été travaillé.`,
      );
    } catch {
      // Toast d'erreur déjà géré par le hook.
    } finally {
      setInFlight(null);
    }
  };

  if (isLoading) return <LoadingPage />;

  const rows = pending || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Fingerprint className="h-6 w-6 text-amber-600" />
          À identifier
        </h1>
        <p className="page-subtitle">
          {rows.length > 0
            ? `${rows.length} entreprise${rows.length > 1 ? 's' : ''} attend${rows.length > 1 ? 'ent' : ''} votre décision — un clic sur la bonne page relance l'enrichissement aussitôt.`
            : 'Quand l\'outil hésitera entre plusieurs entreprises, la question apparaîtra ici.'}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Fingerprint}
          title="Aucune identification en attente"
          description="Tout est tranché. Les prochaines hésitations de l'outil s'afficheront ici au lieu de bloquer l'enrichissement."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const choices = buildChoices(row);
            const busy = inFlight?.signalId === row.signal_id;
            return (
              <div
                key={row.signal_id}
                className="bg-surface rounded-card border border-border p-[22px] animate-fade-in"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <h3 className="font-bold text-navy-800 text-[16px] leading-snug tracking-[-0.01em]">
                    {row.company_name}
                  </h3>
                  <SignalTypeBadge type={row.signal_type as SignalType} />
                  <ScoreStars score={row.score} size="sm" />
                  {row.source_name && (
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-3 font-semibold">
                      {row.source_name}
                    </span>
                  )}
                  {row.failed_at && (
                    <span className="font-mono text-[11px] text-fg-3 ml-auto">
                      {formatDistanceToNow(new Date(row.failed_at), { addSuffix: true, locale: fr })}
                    </span>
                  )}
                </div>

                {row.event_detail && (
                  <p className="text-[13.5px] text-fg-2 line-clamp-2 leading-[1.5] max-w-[80ch]">
                    {row.event_detail}
                  </p>
                )}

                <p className="text-[13px] text-amber-700 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 mt-3">
                  {humanReason(row)}
                </p>

                {choices.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {choices.map((candidate, index) => {
                      const picking = busy && inFlight?.url === candidate.linkedin_url;
                      return (
                        <li
                          key={`${candidate.linkedin_url || candidate.name}-${index}`}
                          className={cn(
                            'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5',
                            candidate.fromMemory
                              ? 'border-emerald-300 bg-emerald-50/50'
                              : 'border-border',
                          )}
                        >
                          <div className="flex-1 min-w-[220px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-[13.5px] text-navy-800">
                                {candidate.name}
                              </span>
                              {candidate.fromMemory && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-badge">
                                  <History className="h-3 w-3" strokeWidth={1.8} />
                                  Déjà retenue par le passé
                                </span>
                              )}
                              {!candidate.fromMemory && (
                                <span className="font-mono text-[10.5px] text-fg-3">
                                  concordance {candidate.score}/100
                                </span>
                              )}
                            </div>
                            {candidate.linkedin_url && (
                              <a
                                href={candidate.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[12px] text-indigo-600 hover:underline mt-0.5 break-all"
                              >
                                <ExternalLink className="h-3 w-3 flex-shrink-0" strokeWidth={1.8} />
                                {candidate.linkedin_url.replace('https://www.', '')}
                              </a>
                            )}
                          </div>
                          <Button
                            size="sm"
                            className="h-8 px-3 text-[12px] bg-indigo-600 hover:bg-indigo-700"
                            disabled={!candidate.linkedin_url || resolveIdentity.isPending}
                            onClick={() => candidate.linkedin_url && pin(row, candidate.linkedin_url, candidate.name)}
                          >
                            {picking ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5 mr-1.5" strokeWidth={2} />
                            )}
                            C'est celle-ci
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13px] text-fg-3 mt-3">
                    L'outil n'a proposé aucune page. Cherchez l'entreprise sur LinkedIn et
                    collez l'adresse de sa page ci-dessous.
                  </p>
                )}

                {/* La saisie manuelle : sans elle, une fiche sans candidate est une
                    impasse — l'opératrice voit le problème, trouve l'entreprise en
                    dix secondes sur LinkedIn, et ne peut rien en faire. */}
                <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <span className="text-[12px] font-semibold text-fg-2">
                      {choices.length > 0
                        ? 'Aucune ne convient ? Collez l\'adresse de la bonne page :'
                        : 'Collez l\'adresse de la page LinkedIn de l\'entreprise :'}
                    </span>
                    <a
                      href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(row.company_name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-indigo-600 hover:underline"
                    >
                      <Search className="h-3 w-3" strokeWidth={1.8} />
                      Chercher « {row.company_name} » sur LinkedIn
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="flex-1 min-w-[240px] h-8 text-[12px]"
                      placeholder="https://www.linkedin.com/company/..."
                      value={manualUrls[row.signal_id] || ''}
                      onChange={(e) =>
                        setManualUrls((previous) => ({ ...previous, [row.signal_id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') pinManual(row);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-[12px]"
                      disabled={!(manualUrls[row.signal_id] || '').trim() || resolveIdentity.isPending}
                      onClick={() => pinManual(row)}
                    >
                      <Pin className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.8} />
                      Épingler
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-[12px] text-fg-3 hover:text-destructive"
                    disabled={resolveIdentity.isPending}
                    onClick={() => rejectAll(row)}
                  >
                    {busy && inFlight?.url === null ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Ban className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.8} />
                    )}
                    Aucune de celles-ci
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
