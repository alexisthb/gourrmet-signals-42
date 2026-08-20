export type ProviderName =
  | "newsapi"
  | "pappers"
  | "apify"
  | "dropcontact"
  | "perplexity"
  | "lovable_ai"
  | "lovable_email"
  | "resend";

export interface ProviderUsageInput {
  provider: ProviderName;
  operation: string;
  businessKey?: string | null;
  requestKey: string;
  signalId?: string | null;
  contactId?: string | null;
  runId?: string | null;
  success: boolean;
  units: number;
  itemsCount: number;
  requestsCount?: number;
  costAmount?: number | null;
  currency?: string | null;
  costSource?:
    | "invoice"
    | "provider_api"
    | "configured_rate"
    | "estimate"
    | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  dispatchStatus?: "unconfirmed" | "confirmed" | "reconciled_no_charge";
  metadata?: Record<string, unknown>;
}

export function buildProviderUsageRow(input: ProviderUsageInput) {
  return {
    provider: input.provider,
    operation: input.operation,
    business_key: input.businessKey ?? null,
    request_key: input.requestKey,
    signal_id: input.signalId ?? null,
    contact_id: input.contactId ?? null,
    run_id: input.runId ?? null,
    units: input.units,
    requests_count: input.requestsCount ?? 1,
    items_count: input.itemsCount,
    cost_amount: input.costAmount ?? null,
    currency: input.currency ?? null,
    cost_source: input.costSource ?? null,
    success: input.success,
    error_code: input.errorCode ?? null,
    dispatch_status: input.dispatchStatus ?? "confirmed",
    metadata: {
      ...(input.metadata || {}),
      http_status: input.httpStatus ?? null,
    },
  };
}

export interface ProviderUsageLedgerClient {
  from(relation: "provider_usage_events"): {
    insert(row: ReturnType<typeof buildProviderUsageRow>): PromiseLike<{
      error: { code?: string; message: string } | null;
    }>;
    update(row: ReturnType<typeof buildProviderUsageRow>): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          eq(column: string, value: unknown): {
            select(columns: string): {
              maybeSingle(): PromiseLike<{
                data: unknown;
                error: { code?: string; message: string } | null;
              }>;
            };
          };
        };
      };
    };
  };
}

export async function persistProviderUsage(
  supabase: ProviderUsageLedgerClient,
  input: ProviderUsageInput,
): Promise<void> {
  const { error } = await supabase.from("provider_usage_events").insert(
    buildProviderUsageRow(input),
  );
  if (error) {
    throw new Error(
      `ledger ${input.provider}/${input.operation}: ${error.message}`,
    );
  }
}

export async function persistProviderUsageOnce(
  supabase: ProviderUsageLedgerClient,
  input: ProviderUsageInput,
): Promise<void> {
  const { error } = await supabase.from("provider_usage_events").insert(
    buildProviderUsageRow(input),
  );
  if (error && error.code !== "23505") {
    throw new Error(
      `ledger ${input.provider}/${input.operation}: ${error.message}`,
    );
  }
}

export async function finalizeProviderUsageDispatch(
  supabase: ProviderUsageLedgerClient,
  input: ProviderUsageInput,
): Promise<void> {
  const { data, error } = await supabase
    .from("provider_usage_events")
    .update(buildProviderUsageRow({ ...input, dispatchStatus: "confirmed" }))
    .eq("provider", input.provider)
    .eq("request_key", input.requestKey)
    .eq("dispatch_status", "unconfirmed")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `ledger finalization ${input.provider}/${input.operation}: ${
        error?.message || "dispatch intent not found"
      }`,
    );
  }
}
