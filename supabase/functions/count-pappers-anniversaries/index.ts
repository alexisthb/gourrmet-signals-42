import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Milestones à tester
const ANNIVERSARY_YEARS = [10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY');
    if (!PAPPERS_API_KEY) {
      throw new Error('PAPPERS_API_KEY not configured');
    }

    const body = await req.json().catch(() => ({}));
    const { anticipationMonths = 9, minEmployees = '20' } = body;

    console.log(`📊 Comptage des entreprises pour chaque milestone anniversaire`);
    console.log(`   Anticipation: ${anticipationMonths} mois`);
    console.log(`   Effectif minimum: ${minEmployees} employés`);

    // Calculer la date d'anniversaire cible (aujourd'hui + anticipation)
    const today = new Date();
    const futureAnniversaryDate = new Date(today);
    futureAnniversaryDate.setMonth(futureAnniversaryDate.getMonth() + anticipationMonths);
    
    const targetDay = futureAnniversaryDate.getDate();
    const targetMonth = futureAnniversaryDate.getMonth() + 1; // 1-indexed
    const targetYear = futureAnniversaryDate.getFullYear();
    
    console.log(`\n🎯 Date d'anniversaire cible: ${String(targetDay).padStart(2, '0')}/${String(targetMonth).padStart(2, '0')}/${targetYear}`);
    console.log(`   (soit dans ${anticipationMonths} mois à partir d'aujourd'hui)\n`);

    const results: { 
      milestone: number; 
      creationDate: string; 
      count: number;
      sampleCompanies: string[];
      apiCreditsUsed: number;
    }[] = [];
    
    let totalCompanies = 0;
    let totalApiCredits = 0;

    for (const milestone of ANNIVERSARY_YEARS) {
      const creationYear = targetYear - milestone;
      const creationDate = `${creationYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
      
      console.log(`\n🔍 ${milestone} ans → Recherche créations du ${creationDate}...`);

      try {
        const params = new URLSearchParams({
          api_token: PAPPERS_API_KEY,
          date_creation_min: creationDate,
          date_creation_max: creationDate,
          per_page: '10', // On ne récupère que quelques exemples
          page: '1',
          statut: 'actif',
        });

        // Filtre effectif minimum
        if (minEmployees && minEmployees !== '0') {
          params.append('tranche_effectif_min', minEmployees);
        }

        const response = await fetch(
          `https://api.pappers.fr/v2/recherche?${params.toString()}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`   ❌ Erreur API: ${response.status} - ${errorText}`);
          results.push({
            milestone,
            creationDate,
            count: -1,
            sampleCompanies: [],
            apiCreditsUsed: 0
          });
          continue;
        }

        const data = await response.json();
        const count = data.total || 0;
        const companies = data.resultats || [];
        
        // Extraire quelques noms d'entreprises comme exemple
        const sampleCompanies = companies.slice(0, 5).map((c: any) => c.denomination);
        
        // Calcul des crédits API (0.1 par résultat récupéré, arrondi)
        const apiCreditsUsed = Math.ceil(count * 0.1);

        console.log(`   ✅ ${count} entreprises trouvées (${apiCreditsUsed} crédits pour scan complet)`);
        if (sampleCompanies.length > 0) {
          console.log(`   📋 Exemples: ${sampleCompanies.slice(0, 3).join(', ')}...`);
        }

        results.push({
          milestone,
          creationDate,
          count,
          sampleCompanies,
          apiCreditsUsed
        });

        totalCompanies += count;
        totalApiCredits += apiCreditsUsed;

        // Pause pour éviter de surcharger l'API
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (error) {
        console.error(`   ❌ Erreur: ${error}`);
        results.push({
          milestone,
          creationDate,
          count: -1,
          sampleCompanies: [],
          apiCreditsUsed: 0
        });
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RÉSUMÉ DU COMPTAGE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\n🎂 Date d'anniversaire cible: ${String(targetDay).padStart(2, '0')}/${String(targetMonth).padStart(2, '0')}/${targetYear}`);
    console.log(`   (dans ${anticipationMonths} mois à partir d'aujourd'hui ${today.toLocaleDateString('fr-FR')})\n`);
    
    console.log(`📈 Résultats par milestone:`);
    for (const r of results) {
      const countStr = r.count >= 0 ? `${r.count} entreprises` : 'Erreur';
      console.log(`   ${r.milestone} ans (créé le ${r.creationDate}): ${countStr}`);
    }
    
    console.log(`\n📊 TOTAL: ${totalCompanies} entreprises à contacter`);
    console.log(`💳 Crédits API estimés pour scan complet: ${totalApiCredits} crédits`);
    console.log(`${'='.repeat(60)}`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        scanDate: today.toISOString().split('T')[0],
        targetAnniversaryDate: `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`,
        anticipationMonths,
        minEmployees,
        totalCompanies,
        estimatedApiCredits: totalApiCredits,
        creditsPerDay: totalApiCredits,
        creditsPerMonth: totalApiCredits * 30,
      },
      milestones: results.map(r => ({
        years: r.milestone,
        creationDate: r.creationDate,
        companiesCount: r.count,
        sampleCompanies: r.sampleCompanies,
        estimatedCredits: r.apiCreditsUsed
      }))
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[count-pappers-anniversaries] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
