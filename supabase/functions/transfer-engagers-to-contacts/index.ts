import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ============= SCORING MULTI-CRITÈRES =============
interface Persona {
  name: string;
  isPriority: boolean;
}

const DEFAULT_PERSONAS: Persona[] = [
  { name: 'Assistant(e) de direction', isPriority: true },
  { name: 'Office Manager', isPriority: true },
  { name: 'Responsable RH', isPriority: false },
  { name: 'Directeur Général', isPriority: false },
  { name: 'DAF / CFO', isPriority: false },
];

// Calcul du score de base selon le persona (1-5)
function getPersonaBaseScore(jobTitle: string | null, personas: Persona[]): number {
  if (!jobTitle) return 3;
  const titleLower = jobTitle.toLowerCase();
  
  // Priorité aux personas configurés
  for (const persona of personas.filter(p => p.isPriority)) {
    const terms = persona.name.toLowerCase().replace(/\(e\)/g, '').replace(/\//g, ' ').split(/\s+/).filter(t => t.length > 2);
    if (terms.some(term => titleLower.includes(term))) return 5;
  }
  
  for (const persona of personas.filter(p => !p.isPriority)) {
    const terms = persona.name.toLowerCase().replace(/\(e\)/g, '').replace(/\//g, ' ').split(/\s+/).filter(t => t.length > 2);
    if (terms.some(term => titleLower.includes(term))) return 4;
  }
  
  // Fallback keywords
  if (titleLower.includes("assistant") || titleLower.includes("office manager") || titleLower.includes("procurement")) return 5;
  if (titleLower.includes("admin") || titleLower.includes("operations")) return 4;
  
  return 3;
}

// Bonus de fraîcheur selon l'âge du signal
function getFreshnessBonus(signalDate: string | null): number {
  if (!signalDate) return 0;
  
  const signalTime = new Date(signalDate).getTime();
  const now = Date.now();
  const daysDiff = (now - signalTime) / (1000 * 60 * 60 * 24);
  
  if (daysDiff <= 7) return 2;   // Signal < 7 jours = +2
  if (daysDiff <= 30) return 1;  // Signal < 30 jours = +1
  return 0;                       // Signal > 30 jours = +0
}

// Calcul du score final (plafonné à 5)
function calculateMultiCriteriaScore(
  jobTitle: string | null, 
  personas: Persona[], 
  signalDate: string | null
): number {
  const baseScore = getPersonaBaseScore(jobTitle, personas);
  const freshnessBonus = getFreshnessBonus(signalDate);
  return Math.min(5, baseScore + freshnessBonus);
}

// Récupère les personas depuis les settings
async function getPersonasConfig(supabase: any): Promise<Persona[]> {
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'personas_linkedin')
    .single();
  
  if (setting?.value) {
    try {
      return JSON.parse(setting.value);
    } catch { /* ignore */ }
  }
  return DEFAULT_PERSONAS;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    console.log(`[transfer-engagers] Starting transfer of LinkedIn engagers to contacts`);

    // Récupérer les personas configurés
    const personas = await getPersonasConfig(supabase);
    console.log(`[transfer-engagers] Using ${personas.length} personas for scoring`);

    // 1. Récupérer tous les engagers non transférés avec leur post
    const { data: engagers, error: engagersError } = await supabase
      .from('linkedin_engagers')
      .select(`
        *,
        linkedin_posts!inner (
          id,
          post_url,
          published_at,
          source_id,
          linkedin_sources (
            id,
            name
          )
        )
      `)
      .eq('transferred_to_contacts', false);

    if (engagersError) {
      console.error(`[transfer-engagers] Error fetching engagers:`, engagersError);
      throw engagersError;
    }

    console.log(`[transfer-engagers] Found ${engagers?.length || 0} engagers to transfer`);

    if (!engagers || engagers.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Aucun engager à transférer',
        transferred: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let transferredCount = 0;
    let signalsCreated = 0;
    let errorsCount = 0;

    for (const engager of engagers) {
      try {
        // Récupérer le nom de la source et la date
        const sourceName = engager.linkedin_posts?.linkedin_sources?.name || 'LinkedIn';
        const postUrl = engager.linkedin_posts?.post_url || null;
        const signalDate = engager.linkedin_posts?.published_at || engager.scraped_at || new Date().toISOString();
        
        // Créer le signal de type linkedin_engagement
        const engagementTypeLabel = engager.engagement_type === 'comment' ? 'Commentaire' : 'Like';
        
        // Score multi-critères : engagement type + persona + fraîcheur
        const engagementBaseScore = engager.engagement_type === 'comment' ? 5 : 
                                     engager.engagement_type === 'share' ? 4 : 3;
        
        const { data: signal, error: signalError } = await supabase
          .from('signals')
          .insert({
            company_name: `Post ${sourceName}`,
            signal_type: 'linkedin_engagement',
            score: engagementBaseScore,
            status: 'new',
            enrichment_status: 'none',
            source_name: 'LinkedIn',
            source_url: postUrl || engager.linkedin_url,
            event_detail: `${engagementTypeLabel} de ${engager.name}${engager.headline ? ` - ${engager.headline}` : ''}`,
            detected_at: signalDate,
          })
          .select()
          .single();

        if (signalError) {
          console.error(`[transfer-engagers] Error creating signal for ${engager.name}:`, signalError);
          errorsCount++;
          continue;
        }

        signalsCreated++;

        // Calcul du score multi-critères pour le contact
        const priorityScore = calculateMultiCriteriaScore(engager.headline, personas, signalDate);
        const isPriorityTarget = getPersonaBaseScore(engager.headline, personas) >= 5;

        console.log(`[transfer-engagers] ${engager.name}: base=${getPersonaBaseScore(engager.headline, personas)}, freshness=+${getFreshnessBonus(signalDate)}, final=${priorityScore}`);

        // Créer le contact lié au signal
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            full_name: engager.name,
            linkedin_url: engager.linkedin_url,
            job_title: engager.headline,
            signal_id: signal.id,
            source: 'linkedin',
            outreach_status: 'new',
            priority_score: priorityScore,
            is_priority_target: isPriorityTarget,
            notes: `Engagement: ${engagementTypeLabel} sur un post de ${sourceName}${engager.comment_text ? `\n\nCommentaire: ${engager.comment_text}` : ''}\n\nScore: ${priorityScore}/5 (base persona + bonus fraîcheur)`,
          })
          .select()
          .single();

        if (contactError) {
          console.error(`[transfer-engagers] Error creating contact for ${engager.name}:`, contactError);
          errorsCount++;
          continue;
        }

        // Mettre à jour l'engager
        const { error: updateError } = await supabase
          .from('linkedin_engagers')
          .update({
            transferred_to_contacts: true,
            contact_id: contact.id,
          })
          .eq('id', engager.id);

        if (updateError) {
          console.error(`[transfer-engagers] Error updating engager ${engager.name}:`, updateError);
        }

        transferredCount++;
        console.log(`[transfer-engagers] Transferred: ${engager.name} (score: ${priorityScore})`);

      } catch (err) {
        console.error(`[transfer-engagers] Error processing engager ${engager.name}:`, err);
        errorsCount++;
      }
    }

    console.log(`[transfer-engagers] Transfer complete: ${transferredCount} contacts, ${signalsCreated} signals, ${errorsCount} errors`);

    return new Response(JSON.stringify({
      success: true,
      message: `${transferredCount} engagers transférés vers les contacts`,
      transferred: transferredCount,
      signals_created: signalsCreated,
      errors: errorsCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[transfer-engagers] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
