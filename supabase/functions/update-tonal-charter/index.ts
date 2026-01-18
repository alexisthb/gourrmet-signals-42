import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Anthropic API key
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'anthropic_api_key')
      .single();

    const anthropicApiKey = settings?.value || Deno.env.get('ANTHROPIC_API_KEY');
    
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Fetch ALL message feedback
    const { data: feedbacks, error: feedbackError } = await supabase
      .from('message_feedback')
      .select('*')
      .order('created_at', { ascending: true });

    if (feedbackError) throw feedbackError;

    if (!feedbacks || feedbacks.length === 0) {
      return new Response(
        JSON.stringify({ success: false, reason: 'No feedback to analyze' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing ${feedbacks.length} message corrections...`);

    // Build the analysis prompt with all corrections
    const correctionsText = feedbacks.map((f, i) => {
      let text = `
=== CORRECTION ${i + 1} (${f.message_type}) ===
Contexte: ${JSON.stringify(f.context)}

MESSAGE ORIGINAL:
${f.original_message}

MESSAGE CORRIGÉ PAR L'UTILISATEUR:
${f.edited_message}
`;
      if (f.original_subject && f.edited_subject && f.original_subject !== f.edited_subject) {
        text += `
SUJET ORIGINAL: ${f.original_subject}
SUJET CORRIGÉ: ${f.edited_subject}
`;
      }
      return text;
    }).join('\n\n');

    const systemPrompt = `Tu es un expert en analyse linguistique et communication professionnelle.
Ta mission est d'analyser les corrections apportées par un utilisateur à des messages générés automatiquement
pour en déduire sa "charte tonale" personnelle : ses préférences de style, ton, vocabulaire et structure.

Tu dois produire un document JSON structuré qui capture de manière précise et actionnable les préférences détectées.
Plus tu as de corrections à analyser, plus ta synthèse sera précise et la confiance élevée.

IMPORTANT:
- Identifie les PATTERNS RÉCURRENTS (pas les cas isolés)
- Sois SPÉCIFIQUE dans tes observations (avec exemples concrets)
- Calcule un score de confiance basé sur:
  * Nombre de corrections (5-10: faible, 10-30: moyen, 30+: élevé)
  * Cohérence des patterns détectés
  * Diversité des contextes couverts`;

    const userPrompt = `Analyse les ${feedbacks.length} corrections suivantes et génère une charte tonale JSON:

${correctionsText}

---

Génère UNIQUEMENT un objet JSON valide (sans markdown, sans explication) avec cette structure exacte:
{
  "formality": {
    "level": "formel|semi-formel|informel|très-informel",
    "tutoyment": true/false,
    "observations": ["observation 1 avec exemple", "observation 2 avec exemple"]
  },
  "structure": {
    "max_paragraphs": number,
    "sentence_length": "courte|moyenne|longue",
    "bullet_points": true/false,
    "observations": ["observation avec exemple"]
  },
  "vocabulary": {
    "forbidden_words": ["mot1", "mot2"],
    "preferred_words": ["mot1", "mot2"],
    "forbidden_expressions": ["expression1", "expression2"],
    "preferred_expressions": ["expression1", "expression2"],
    "observations": ["observation avec exemple"]
  },
  "tone": {
    "style": "professionnel|décontracté|espiègle|direct|chaleureux",
    "humor_allowed": true/false,
    "energy_level": "calme|dynamique|enthousiaste",
    "observations": ["observation avec exemple"]
  },
  "signatures": {
    "preferred": ["signature1", "signature2"],
    "avoided": ["signature1", "signature2"]
  },
  "openings": {
    "preferred": ["accroche1", "accroche2"],
    "avoided": ["accroche1", "accroche2"]
  },
  "subjects_email": {
    "max_length": number,
    "style": "descriptif|accrocheur|minimaliste",
    "observations": ["observation"]
  },
  "confidence_score": 0.0-1.0,
  "patterns_detected": number,
  "summary": "Résumé en une phrase du style de l'utilisateur"
}`;

    // Call Anthropic API
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt
      })
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error('Anthropic API error:', errorText);
      throw new Error(`Anthropic API error: ${anthropicResponse.status}`);
    }

    const anthropicData = await anthropicResponse.json();
    const responseText = anthropicData.content[0]?.text || '';
    
    console.log('Anthropic response received, parsing...');

    // Parse the JSON response
    let charterData;
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        charterData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Error parsing charter JSON:', parseError);
      console.log('Raw response:', responseText);
      throw new Error('Failed to parse charter from AI response');
    }

    // Extract confidence score
    const confidenceScore = Math.min(1, Math.max(0, charterData.confidence_score || 
      Math.min(0.95, feedbacks.length * 0.03))); // Fallback: ~3% per correction, max 95%

    // Update the tonal charter
    const { error: updateError } = await supabase
      .from('tonal_charter')
      .update({
        charter_data: charterData,
        corrections_count: feedbacks.length,
        last_analysis_at: new Date().toISOString(),
        confidence_score: confidenceScore
      })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all rows

    if (updateError) throw updateError;

    console.log('Tonal charter updated successfully');
    console.log('Confidence score:', confidenceScore);
    console.log('Summary:', charterData.summary);

    return new Response(
      JSON.stringify({
        success: true,
        corrections_analyzed: feedbacks.length,
        confidence_score: confidenceScore,
        charter_summary: charterData.summary,
        patterns_detected: charterData.patterns_detected
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in update-tonal-charter:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
