const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PressScanLease = {
  scanLogId: string;
  leaseToken: string;
};

function readUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function parsePressScanResume(
  body: Record<string, unknown>,
): PressScanLease | null {
  const rawId = body.scan_log_id;
  const rawToken = body.lease_token;
  if (rawId == null && rawToken == null) return null;

  const scanLogId = readUuid(rawId);
  const leaseToken = readUuid(rawToken);
  if (!scanLogId || !leaseToken) {
    throw new Error(
      "scan_log_id et lease_token UUID sont requis ensemble pour reprendre un scan Presse",
    );
  }
  return { scanLogId, leaseToken };
}

export function requirePressScanLease(
  body: Record<string, unknown>,
  idField: "run_id" | "scan_log_id" = "run_id",
): PressScanLease {
  const scanLogId = readUuid(body[idField]);
  const leaseToken = readUuid(body.lease_token);
  if (!scanLogId || !leaseToken) {
    throw new Error(
      `${idField} et lease_token UUID sont requis pour cette opération Presse`,
    );
  }
  return { scanLogId, leaseToken };
}

export function buildPressResumePayload(
  lease: PressScanLease,
  fetchPartialError: string | null,
): Record<string, unknown> {
  return {
    scan_log_id: lease.scanLogId,
    lease_token: lease.leaseToken,
    skip_fetch: true,
    fetch_partial_error: fetchPartialError,
  };
}
