import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Building2,
  MapPin,
  Users,
  TrendingUp,
  Euro,
  Briefcase,
  Hash,
  CalendarDays,
  Timer,
  Cake,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

// Fiche entreprise Pappers (SIREN, compte à rebours anniversaire, données société).
// Rendue au-dessus de la gestion Presse pour un signal d'origine Pappers, afin de conserver
// la richesse Pappers tout en réutilisant l'interface de gestion Presse (statut, contacts…).

function getCompanyDataValue(companyData: unknown, key: string): string | number | null {
  if (typeof companyData === 'object' && companyData !== null && !Array.isArray(companyData)) {
    const obj = companyData as Record<string, unknown>;
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
  }
  return null;
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(num));
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1).replace('.', ',')} M€`;
  }
  if (amount >= 1000) {
    return `${formatNumber(amount)} €`;
  }
  return `${amount} €`;
}

export interface PappersFicheData {
  siren?: string | null;
  relevance_score?: number | null;
  company_data?: unknown;
}

export function PappersFicheCard({ signal }: { signal: PappersFicheData }) {
  const companyData = signal.company_data;

  const anniversaryDate = getCompanyDataValue(companyData, 'anniversary_date');
  const anniversaryYears = getCompanyDataValue(companyData, 'anniversary_years');
  const dateCreation = getCompanyDataValue(companyData, 'date_creation');
  const effectif = getCompanyDataValue(companyData, 'effectif');
  const ville = getCompanyDataValue(companyData, 'ville');
  const codePostal = getCompanyDataValue(companyData, 'code_postal');
  const region = getCompanyDataValue(companyData, 'region');
  const chiffreAffaires = getCompanyDataValue(companyData, 'chiffre_affaires');
  const codeNaf = getCompanyDataValue(companyData, 'code_naf');
  const libelleCodeNaf = getCompanyDataValue(companyData, 'libelle_code_naf');
  const formeJuridique = getCompanyDataValue(companyData, 'forme_juridique');

  let anniversaryValid = false;
  if (anniversaryDate) {
    const d = new Date(String(anniversaryDate));
    anniversaryValid = !Number.isNaN(d.getTime());
  }

  return (
    <div className="space-y-6">
      {/* HERO: compte à rebours anniversaire */}
      {anniversaryYears && anniversaryValid && (
        <Card className="overflow-hidden border-2 border-secondary/30 bg-gradient-to-br from-secondary/5 to-transparent">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-secondary/20">
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <Cake className="h-10 w-10 text-secondary mb-3" />
                <div className="text-5xl font-display font-bold text-secondary">
                  {anniversaryYears}
                </div>
                <span className="text-lg text-muted-foreground">ans</span>
              </div>
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <CalendarDays className="h-10 w-10 text-secondary mb-3" />
                <div className="text-2xl font-display font-bold text-foreground">
                  {format(new Date(String(anniversaryDate)), 'dd MMMM yyyy', { locale: fr })}
                </div>
                <span className="text-sm text-muted-foreground">Date d'anniversaire</span>
              </div>
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <Timer className="h-10 w-10 text-secondary mb-3" />
                <div className="text-4xl font-display font-bold text-foreground">
                  {differenceInDays(new Date(String(anniversaryDate)), new Date())}
                </div>
                <span className="text-sm text-muted-foreground">jours restants</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fiche entreprise Pappers */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-secondary" />
            Fiche entreprise (Pappers)
            <Badge variant="outline" className="ml-auto text-xs">Données gratuites</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Identification */}
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <Hash className="h-4 w-4" />
              Identification
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {signal.siren && (
                <div className="p-4 rounded-xl bg-muted/50 border border-border">
                  <span className="text-xs text-muted-foreground">SIREN</span>
                  <p className="font-mono font-semibold text-lg">{signal.siren}</p>
                </div>
              )}
              {dateCreation && (
                <div className="p-4 rounded-xl bg-muted/50 border border-border">
                  <span className="text-xs text-muted-foreground">Création</span>
                  <p className="font-semibold">
                    {format(new Date(String(dateCreation)), 'dd/MM/yyyy', { locale: fr })}
                  </p>
                </div>
              )}
              {formeJuridique && (
                <div className="p-4 rounded-xl bg-muted/50 border border-border md:col-span-1 col-span-2">
                  <span className="text-xs text-muted-foreground">Forme juridique</span>
                  <p className="font-semibold text-sm">{formeJuridique}</p>
                </div>
              )}
            </div>
          </div>

          {libelleCodeNaf && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Activité
                </h4>
                <div className="p-4 rounded-xl bg-secondary/5 border border-secondary/20">
                  <span className="text-xs text-muted-foreground">Secteur d'activité</span>
                  <p className="font-semibold text-foreground">{libelleCodeNaf}</p>
                  {codeNaf && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      NAF {codeNaf}
                    </Badge>
                  )}
                </div>
              </div>
            </>
          )}

          {(effectif || chiffreAffaires) && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Taille & Finances
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {effectif && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">Effectif</span>
                      </div>
                      <p className="font-semibold text-lg text-foreground">{effectif}</p>
                    </div>
                  )}
                  {chiffreAffaires && (
                    <div className="p-4 rounded-xl bg-gradient-to-br from-success/5 to-transparent border border-success/20">
                      <div className="flex items-center gap-2 mb-1">
                        <Euro className="h-4 w-4 text-success" />
                        <span className="text-xs text-muted-foreground">Chiffre d'affaires</span>
                      </div>
                      <p className="font-semibold text-lg text-foreground">
                        {formatCurrency(Number(chiffreAffaires))}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {(ville || region) && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Localisation
                </h4>
                <div className="p-4 rounded-xl bg-muted/50 border border-border">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-secondary/10">
                      <MapPin className="h-5 w-5 text-secondary" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">
                        {ville}
                        {codePostal && ` (${codePostal})`}
                      </p>
                      {region && (
                        <Badge variant="secondary" className="mt-2">
                          {region}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
