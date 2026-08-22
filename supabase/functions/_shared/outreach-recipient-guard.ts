// LA FRONTIÈRE ENTRE « UNE ADRESSE EXISTE » ET « ON PEUT Y ÉCRIRE ».
//
// Mesuré le 2026-08-22 : 4 704 contacts portent une adresse, 41 sont vérifiées,
// 40 sont explicitement introuvables (`not_found`), 5 044 n'ont jamais été
// classées. Or le bouton d'envoi apparaissait dès qu'une adresse existait, et
// le backend ne contrôlait que la liste de suppression.
//
// Le blocage Resend (domaine non vérifié) masquait ce défaut : rien ne partait,
// donc rien ne se voyait. Le jour où le domaine sera vérifié, le premier lot
// d'envois partirait vers des adresses jamais vérifiées ou déclarées mortes —
// et c'est LE comportement qui détruit la réputation d'un domaine neuf en une
// journée : les bounces des 40 `not_found` sont garantis, ceux des 5 044
// non-classées sont probables (une partie vient d'enrichissements `lovable_ai`
// aux domaines inventés).
//
// La règle est donc fermée par défaut : UN ENVOI DE PROSPECTION EXIGE UNE
// ADRESSE VÉRIFIÉE. Le chemin pour élargir le stock n'est pas d'assouplir la
// garde, c'est de faire vérifier les adresses par Dropcontact — le pipeline
// existe et coûte moins cher qu'une réputation.
//
// La décision est une fonction PURE, séparée de l'edge function qui l'applique,
// pour être éprouvée cas par cas au banc Deno — la leçon de la journée : une
// garde non appelée par un test finit par être fausse sans que rien ne le dise.

export interface OutreachContactRecord {
  email_principal: string | null;
  email_verification_status: string | null;
}

export type OutreachRecipientDecision =
  | { ok: true }
  | { ok: false; status: number; reason: string; error: string };

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function assessOutreachRecipient(
  contact: OutreachContactRecord | null,
  requestedEmail: string,
): OutreachRecipientDecision {
  if (!contact) {
    return {
      ok: false,
      status: 404,
      reason: "contact_not_found",
      error: "Contact introuvable : un envoi de prospection doit être rattaché à une fiche contact existante.",
    };
  }

  const onFile = normalizeEmail(contact.email_principal);
  const requested = normalizeEmail(requestedEmail);

  if (onFile === "") {
    return {
      ok: false,
      status: 409,
      reason: "contact_has_no_email",
      error: "La fiche contact ne porte aucune adresse email.",
    };
  }

  // L'adresse éditée à la main dans le dialogue ne doit jamais diverger de la
  // fiche : sinon la vérification porte sur une adresse et l'envoi sur une
  // autre. La correction se fait sur la fiche, pas dans le champ d'envoi.
  if (onFile !== requested) {
    return {
      ok: false,
      status: 409,
      reason: "recipient_mismatch",
      error: "L'adresse demandée ne correspond pas à la fiche contact. " +
        "Corrigez d'abord l'adresse sur la fiche : la vérification porte sur elle.",
    };
  }

  const status = (contact.email_verification_status ?? "").trim().toLowerCase();

  if (status === "not_found") {
    return {
      ok: false,
      status: 403,
      reason: "email_known_missing",
      error: "Le fournisseur de vérification a explicitement déclaré cette adresse introuvable. " +
        "Un envoi rebondirait à coup sûr et abîmerait la réputation du domaine.",
    };
  }

  if (status !== "verified") {
    return {
      ok: false,
      status: 403,
      reason: "email_not_verified",
      error: "Cette adresse n'a jamais été vérifiée" +
        (status === "" ? "" : ` (statut : ${status})`) +
        ". La prospection n'envoie que vers des adresses vérifiées — " +
        "lancez une vérification Dropcontact sur ce contact pour la débloquer.",
    };
  }

  return { ok: true };
}
