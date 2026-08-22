import { assessOutreachRecipient } from "./outreach-recipient-guard.ts";

function assertRefusal(
  decision: ReturnType<typeof assessOutreachRecipient>,
  status: number,
  reason: string,
) {
  if (decision.ok) throw new Error(`attendu un refus ${reason}, obtenu ok`);
  if (decision.status !== status || decision.reason !== reason) {
    throw new Error(
      `attendu ${status}/${reason}, obtenu ${decision.status}/${decision.reason}`,
    );
  }
}

// Le seul cas passant : la fiche existe, l'adresse demandée est celle de la
// fiche, et elle est vérifiée. Tout le reste refuse — c'est une garde de
// réputation, pas un filtre de confort.
Deno.test("une adresse verifiee et conforme a la fiche passe", () => {
  const d = assessOutreachRecipient(
    { email_principal: "  Marie.Dupont@Acme.FR ", email_verification_status: "verified" },
    "marie.dupont@acme.fr",
  );
  if (!d.ok) throw new Error(`attendu ok, obtenu ${JSON.stringify(d)}`);
});

Deno.test("sans fiche contact, aucun envoi de prospection", () => {
  assertRefusal(assessOutreachRecipient(null, "x@y.fr"), 404, "contact_not_found");
});

Deno.test("une adresse editee qui diverge de la fiche est refusee", () => {
  // Le champ libre du dialogue ne doit pas permettre d'envoyer vers une
  // adresse que personne n'a vérifiée — la correction se fait sur la fiche.
  assertRefusal(
    assessOutreachRecipient(
      { email_principal: "vrai@acme.fr", email_verification_status: "verified" },
      "autre@acme.fr",
    ),
    409,
    "recipient_mismatch",
  );
});

Deno.test("une adresse declaree introuvable par le fournisseur est un mur", () => {
  // 40 contacts en production portent `not_found` : le fournisseur a cherché
  // et dit NON. Envoyer quand même garantit le bounce.
  assertRefusal(
    assessOutreachRecipient(
      { email_principal: "x@y.fr", email_verification_status: "not_found" },
      "x@y.fr",
    ),
    403,
    "email_known_missing",
  );
});

Deno.test("une adresse jamais classee reste fermee par defaut", () => {
  // 5 044 contacts en production : une adresse présente n'est pas une adresse
  // sûre — une partie vient d'enrichissements aux domaines inventés.
  assertRefusal(
    assessOutreachRecipient(
      { email_principal: "x@y.fr", email_verification_status: null },
      "x@y.fr",
    ),
    403,
    "email_not_verified",
  );
  assertRefusal(
    assessOutreachRecipient(
      { email_principal: "x@y.fr", email_verification_status: "pending" },
      "x@y.fr",
    ),
    403,
    "email_not_verified",
  );
});

Deno.test("une fiche sans adresse ne peut rien recevoir", () => {
  assertRefusal(
    assessOutreachRecipient(
      { email_principal: null, email_verification_status: "verified" },
      "x@y.fr",
    ),
    409,
    "contact_has_no_email",
  );
});
