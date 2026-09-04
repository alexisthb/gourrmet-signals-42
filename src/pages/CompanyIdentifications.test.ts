import { describe, expect, it } from 'vitest';
import { normalizeLinkedInCompanyUrl } from './CompanyIdentifications';

/**
 * Le portier de la saisie manuelle (demande de Clotilde du 04/09 : certaines
 * fiches ne portent aucune candidate). Se tromper ici coûte cher dans les deux
 * sens : trop strict, on reproche à l'opératrice un copier-coller normal ;
 * trop laxiste, on épingle un profil de personne et l'échec ne se manifeste
 * que deux étages plus loin, au scrape des employés — illisible.
 */
describe('normalizeLinkedInCompanyUrl', () => {
  it('accepte ce que LinkedIn donne vraiment à copier', () => {
    const attendu = 'https://www.linkedin.com/company/pasqal';
    // Forme canonique.
    expect(normalizeLinkedInCompanyUrl(attendu)).toBe(attendu);
    // Slash final, paramètres de suivi, sous-domaine régional, espaces, et
    // l'adresse sans schéma que donne un copier-coller depuis la barre d'URL.
    expect(normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/pasqal/')).toBe(attendu);
    expect(normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/pasqal/?originalSubdomain=fr')).toBe(attendu);
    expect(normalizeLinkedInCompanyUrl('https://fr.linkedin.com/company/pasqal')).toBe(attendu);
    expect(normalizeLinkedInCompanyUrl('  https://www.linkedin.com/company/pasqal/about/  ')).toBe(attendu);
    expect(normalizeLinkedInCompanyUrl('www.linkedin.com/company/pasqal')).toBe(attendu);
    expect(normalizeLinkedInCompanyUrl('linkedin.com/company/pasqal')).toBe(attendu);
  });

  it('refuse ce qui n est pas une page entreprise', () => {
    // Un profil de personne : la cause n°1 de confusion, et un échec muet.
    expect(normalizeLinkedInCompanyUrl('https://www.linkedin.com/in/marie-lefevre')).toBeNull();
    expect(normalizeLinkedInCompanyUrl('https://www.linkedin.com/school/hec-paris')).toBeNull();
    expect(normalizeLinkedInCompanyUrl('https://pasqal.com')).toBeNull();
    // Un domaine qui imite LinkedIn sans en être.
    expect(normalizeLinkedInCompanyUrl('https://linkedin.com.evil.example/company/pasqal')).toBeNull();
    expect(normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/')).toBeNull();
    expect(normalizeLinkedInCompanyUrl('   ')).toBeNull();
    expect(normalizeLinkedInCompanyUrl('nimporte quoi')).toBeNull();
  });

  it('produit une forme stable, sans quoi la memoire des identites se perd', () => {
    // Deux copier-coller différents de la MÊME page doivent donner la même
    // chaîne : la re-proposition aux signaux suivants compare des URL.
    expect(normalizeLinkedInCompanyUrl('https://fr.linkedin.com/company/bnp-paribas-arval/?trk=x'))
      .toBe(normalizeLinkedInCompanyUrl('https://www.linkedin.com/company/bnp-paribas-arval'));
  });
});
