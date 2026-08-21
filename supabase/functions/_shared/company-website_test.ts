import { buildLogoDomainCandidates, firstUsableDomain } from "./company-website.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(message ?? `Attendu ${right}, obtenu ${left}`);
}

// Toutes les chaînes ci-dessous sont RÉELLES : elles viennent du champ
// `website` de signaux de score >= 4 restés sans logo au 2026-08-21.
Deno.test("une adresse unique traverse, sans le www", () => {
  assertEquals(firstUsableDomain("https://www.ardian.com"), "ardian.com");
  assertEquals(firstUsableDomain("https://astekgroup.fr"), "astekgroup.fr");
  assertEquals(firstUsableDomain("https://www.groupe-legendre.com"), "groupe-legendre.com");
  assertEquals(firstUsableDomain("https://www.akkodis.com/fr"), "akkodis.com");
});

Deno.test("plusieurs adresses concatenees : on garde la premiere", () => {
  // C'est ce cas qui faisait retomber la recherche sur une devinette.
  assertEquals(
    firstUsableDomain("https://www.orange.com / https://www.free.fr / https://www.bouyguestelecom.fr"),
    "orange.com",
  );
  assertEquals(
    firstUsableDomain(
      "https://www.cardiologiepoledescliniques.fr / https://www.urgencespoledescliniques.fr",
    ),
    "cardiologiepoledescliniques.fr",
  );
  assertEquals(firstUsableDomain("acme.fr, autre.com"), "acme.fr");
});

Deno.test("un domaine nu, sans protocole, reste exploitable", () => {
  assertEquals(firstUsableDomain("dekuple.com"), "dekuple.com");
  assertEquals(firstUsableDomain("www.logistafrance.fr"), "logistafrance.fr");
});

Deno.test("rien n'est invente : ce qui n'est pas un domaine rend null", () => {
  assertEquals(firstUsableDomain(null), null);
  assertEquals(firstUsableDomain(""), null);
  assertEquals(firstUsableDomain("   "), null);
  assertEquals(firstUsableDomain("pas une adresse du tout"), null);
  assertEquals(firstUsableDomain("https://localhost"), null);
  assertEquals(firstUsableDomain("ftp://fichiers.example.com"), null);
  assertEquals(firstUsableDomain(42), null);
});

// Le défaut le plus coûteux de la chaîne logo, mesuré le 2026-08-21 :
// `ardian.com` ne résout pas, `www.ardian.com` rend 15 ko d'icône valide.
// L'ancien code retirait le `www.` d'une adresse correcte, puis brûlait cinq
// tentatives sur un domaine inexistant.
Deno.test("chaque domaine est essaye avec ET sans www", () => {
  const c = buildLogoDomainCandidates("ardian.com");
  assertEquals(c.includes("ardian.com"), true);
  assertEquals(c.includes("www.ardian.com"), true, "la variante www manquait : elle coutait des logos entiers");
});

Deno.test("le www deja present n'est pas duplique", () => {
  assertEquals(buildLogoDomainCandidates("www.ardian.com"), ["ardian.com", "www.ardian.com", "ardian.fr", "www.ardian.fr"]);
});

Deno.test("les variantes .fr et sans qualificatif sont conservees", () => {
  const c = buildLogoDomainCandidates("groupe-legendre.com");
  assertEquals(c.includes("groupe-legendre.com"), true);
  assertEquals(c.includes("www.groupe-legendre.com"), true);
  assertEquals(c.includes("groupe-legendre.fr"), true);
  // « -france » est un qualificatif, pas une marque : on tente aussi sans.
  const d = buildLogoDomainCandidates("acme-france.com");
  assertEquals(d.includes("acme.com"), true);
  assertEquals(d.includes("www.acme.com"), true);
});

Deno.test("une entree vide ne produit aucun candidat", () => {
  assertEquals(buildLogoDomainCandidates(""), []);
  assertEquals(buildLogoDomainCandidates("   "), []);
});
