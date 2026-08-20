import { isPappersAutoEnrichmentEnabled } from './pappers-auto-enrich.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
}

Deno.test('auto-enrich Pappers respecte les trois interrupteurs produit', () => {
  assertEquals(isPappersAutoEnrichmentEnabled({
    generalAuto: null,
    pappersMaster: null,
    pappersAuto: 'true',
  }), true);
  assertEquals(isPappersAutoEnrichmentEnabled({
    generalAuto: 'false',
    pappersMaster: null,
    pappersAuto: 'true',
  }), false);
  assertEquals(isPappersAutoEnrichmentEnabled({
    generalAuto: 'true',
    pappersMaster: 'false',
    pappersAuto: 'true',
  }), false);
  assertEquals(isPappersAutoEnrichmentEnabled({
    generalAuto: 'true',
    pappersMaster: 'true',
    pappersAuto: null,
  }), false);
});
