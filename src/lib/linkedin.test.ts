import { describe, expect, it } from "vitest";
import { isOpaqueLinkedInProfileUrl, usableLinkedInProfileUrl } from "./linkedin";

// Les URL ci-dessous viennent de la base de production (contacts NAMSA et
// JALIOS remontés le 2026-08-21). Aucune n'est inventée.
describe("reconnaissance d'un lien LinkedIn qui n'ouvre rien", () => {
  it("reconnaît un identifiant interne", () => {
    expect(isOpaqueLinkedInProfileUrl(
      "https://www.linkedin.com/in/ACwAAFO5DxQBxpGlHssB5Xd1UOB47oZsaHIWry4",
    )).toBe(true);
    expect(isOpaqueLinkedInProfileUrl(
      "https://www.linkedin.com/in/ACwAACVDRAUBbv-555GZevD7Mdu7JODDDaSGM1w",
    )).toBe(true);
  });

  it("laisse passer un vrai nom public", () => {
    expect(isOpaqueLinkedInProfileUrl("https://www.linkedin.com/in/marie-durand-rh")).toBe(false);
    expect(isOpaqueLinkedInProfileUrl("https://www.linkedin.com/in/damien-briotet")).toBe(false);
  });

  it("ne confond pas un nom commençant par ac avec un identifiant interne", () => {
    // « acme-consulting » commence par « ac » mais reste un nom public.
    expect(isOpaqueLinkedInProfileUrl("https://www.linkedin.com/in/acme-consulting")).toBe(false);
    expect(isOpaqueLinkedInProfileUrl("https://www.linkedin.com/in/academie-du-gout")).toBe(false);
  });

  it("traite l'absence d'URL comme une absence, pas comme un lien mort", () => {
    expect(isOpaqueLinkedInProfileUrl(null)).toBe(false);
    expect(isOpaqueLinkedInProfileUrl(undefined)).toBe(false);
    expect(isOpaqueLinkedInProfileUrl("")).toBe(false);
    expect(isOpaqueLinkedInProfileUrl("https://www.linkedin.com/company/acme")).toBe(false);
  });

  it("ne propose au clic que ce qui s'ouvre vraiment", () => {
    expect(usableLinkedInProfileUrl("https://www.linkedin.com/in/marie-durand-rh"))
      .toBe("https://www.linkedin.com/in/marie-durand-rh");
    expect(usableLinkedInProfileUrl(
      "https://www.linkedin.com/in/ACwAAFO5DxQBxpGlHssB5Xd1UOB47oZsaHIWry4",
    )).toBeNull();
    expect(usableLinkedInProfileUrl(null)).toBeNull();
  });
});
