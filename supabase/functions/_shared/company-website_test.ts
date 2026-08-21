import { firstUsableDomain } from "./company-website.ts";

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
