import {
  buildPressResumePayload,
  parsePressScanResume,
  requirePressScanLease,
} from "./press-scan-lease.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertThrows(fn: () => unknown, expectedMessage: string) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedMessage)) return;
    throw new Error(
      `Expected error containing "${expectedMessage}", received "${message}"`,
    );
  }
  throw new Error(`Expected an error containing "${expectedMessage}"`);
}

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "20000000-0000-4000-8000-000000000002";

Deno.test("parsePressScanResume accepts an initial scan without lease context", () => {
  assertEquals(parsePressScanResume({}), null);
});

Deno.test("parsePressScanResume requires the previous token when resuming", () => {
  assertThrows(
    () => parsePressScanResume({ scan_log_id: RUN_ID }),
    "scan_log_id et lease_token UUID sont requis ensemble",
  );
});

Deno.test("a valid resume and analyzer context preserve the exact lease pair", () => {
  const expected = { scanLogId: RUN_ID, leaseToken: LEASE_TOKEN };
  assertEquals(
    parsePressScanResume({ scan_log_id: RUN_ID, lease_token: LEASE_TOKEN }),
    expected,
  );
  assertEquals(
    requirePressScanLease({ run_id: RUN_ID, lease_token: LEASE_TOKEN }),
    expected,
  );
});

Deno.test("requirePressScanLease rejects a forged or incomplete analyzer context", () => {
  assertThrows(
    () => requirePressScanLease({ run_id: RUN_ID, lease_token: "not-a-token" }),
    "run_id et lease_token UUID sont requis",
  );
});

Deno.test("the auto-resume payload forwards the currently owned token", () => {
  const payload = buildPressResumePayload(
    { scanLogId: RUN_ID, leaseToken: LEASE_TOKEN },
    "fetch partiel",
  );
  assertEquals(payload, {
    scan_log_id: RUN_ID,
    lease_token: LEASE_TOKEN,
    skip_fetch: true,
    fetch_partial_error: "fetch partiel",
  });
});
