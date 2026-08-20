import { sendLovableEmail } from "npm:@lovable.dev/email-js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  EmailProviderError,
  resolveEmailProvider,
  sendResendEmail,
} from "../_shared/email-delivery.ts";
import {
  persistProviderUsageOnce as persistProviderUsageEvent,
} from "../_shared/provider-usage.ts";

const MAX_RETRIES = 5;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_SEND_DELAY_MS = 200;
const DEFAULT_AUTH_TTL_MINUTES = 15;
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60;
const DEFAULT_OUTREACH_TTL_MINUTES = 24 * 60;

// Check if an error is a rate-limit (429) response.
// Uses EmailAPIError.status when available (email-js >=0.x with structured errors),
// falls back to parsing the error message for older versions.
function isRateLimited(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 429;
  }
  return error instanceof Error && error.message.includes("429");
}

// Check if an error is a forbidden (403) response. Retrying won't help.
// Move straight to DLQ.
function isForbidden(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 403;
  }
  return error instanceof Error && error.message.includes("403");
}

function isPermanentProviderFailure(error: unknown): boolean {
  if (!(error instanceof EmailProviderError)) return isForbidden(error);
  if (error.status === 409) {
    return error.code !== "concurrent_idempotent_requests";
  }
  return error.status >= 400 && error.status < 500 &&
    ![408, 429].includes(error.status);
}

// Extract Retry-After seconds from a structured EmailAPIError, or default to 60s.
function getRetryAfterSeconds(error: unknown): number {
  if (error && typeof error === "object" && "retryAfterSeconds" in error) {
    return (error as { retryAfterSeconds: number | null }).retryAfterSeconds ??
      60;
  }
  return 60;
}

async function persistProviderUsage(
  // Edge functions use migrations newer than the generated frontend client.
  // deno-lint-ignore no-explicit-any
  supabase: any,
  input: {
    provider: "resend" | "lovable_email";
    requestKey: string;
    queueMessageId: string | null;
    providerMessageId: string | null;
    templateName: string;
    signalId: string | null;
    contactId: string | null;
    success: boolean;
    units: number;
    errorCode: string | null;
    httpStatus?: number | null;
    providerStatus?: string | null;
  },
): Promise<boolean> {
  try {
    await persistProviderUsageEvent(supabase, {
      provider: input.provider,
      operation: "send_email",
      requestKey: input.requestKey,
      signalId: input.signalId,
      contactId: input.contactId,
      success: input.success,
      units: input.units,
      requestsCount: 1,
      itemsCount: input.success ? 1 : 0,
      httpStatus: input.httpStatus ?? null,
      errorCode: input.errorCode,
      metadata: {
        queue_message_id: input.queueMessageId,
        provider_message_id: input.providerMessageId,
        template_name: input.templateName,
        provider_status: input.providerStatus ?? null,
      },
    });
  } catch (error) {
    console.error("Provider usage ledger write failed", {
      provider: input.provider,
      request_key: input.requestKey,
      error,
    });
    return false;
  }
  return true;
}

function providerErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string" && error.code) {
      return error.code.slice(0, 120);
    }
    if ("status" in error && Number.isFinite(Number(error.status))) {
      return `http_${Number(error.status)}`;
    }
  }
  return "provider_request_failed";
}

function providerHttpStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

// Move a message to the dead letter queue and log the reason.
async function moveToDlq(
  // This worker intentionally uses an ungenerated Edge-Function client: its
  // queue RPCs are added by migrations and are absent from frontend types.
  // deno-lint-ignore no-explicit-any
  supabase: any,
  queue: string,
  msg: { msg_id: number; message: Record<string, unknown> },
  reason: string,
  trackedOutreach = false,
): Promise<void> {
  const payload = msg.message;
  if (trackedOutreach && typeof payload.message_id === "string") {
    const { error: trackingError } = await supabase.rpc("fail_tracked_email", {
      p_message_id: payload.message_id,
      p_error_message: reason,
    });
    if (trackingError) {
      console.error("Failed to mark tracked email as failed before DLQ", {
        message_id: payload.message_id,
        error: trackingError,
      });
      throw new Error(
        `Tracked email state unavailable before DLQ: ${trackingError.message}`,
      );
    }
  }
  const { error } = await supabase.rpc("move_to_dlq", {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msg_id,
    payload,
  });
  if (error) {
    console.error("Failed to move message to DLQ", {
      queue,
      msg_id: msg.msg_id,
      reason,
      error,
    });
    throw new Error(`DLQ move failed: ${error.message}`);
  }
  const { error: logError } = await supabase.from("email_send_log").insert({
    message_id: payload.message_id,
    template_name: (payload.label || queue) as string,
    recipient_email: payload.to,
    status: "dlq",
    error_message: reason,
  });
  if (logError) {
    console.error("Message moved to DLQ but audit log write failed", {
      queue,
      msg_id: msg.msg_id,
      error: logError,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, {
    responseHeaders: corsHeaders,
  });
  if (!access.ok) return access.response;

  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing required environment variables");
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // 1. Check rate-limit cooldown and read queue config
  const { data: state, error: stateError } = await supabase
    .from("email_send_state")
    .select(
      "retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes, outreach_email_ttl_minutes",
    )
    .single();
  if (stateError) {
    return new Response(
      JSON.stringify({
        error: `Email state unavailable: ${stateError.message}`,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (
    state?.retry_after_until && new Date(state.retry_after_until) > new Date()
  ) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "rate_limited" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE;
  const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS;
  const ttlMinutes: Record<string, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails: state?.transactional_email_ttl_minutes ??
      DEFAULT_TRANSACTIONAL_TTL_MINUTES,
  };
  const outreachTtlMinutes = state?.outreach_email_ttl_minutes ??
    DEFAULT_OUTREACH_TTL_MINUTES;

  let totalProcessed = 0;
  const queueReadFailures: Array<{ queue: string; error: string }> = [];

  // 2. Process auth_emails first (priority), then transactional_emails
  for (const queue of ["auth_emails", "transactional_emails"]) {
    const { data: messages, error: readError } = await supabase.rpc(
      "read_email_batch",
      {
        queue_name: queue,
        batch_size: batchSize,
        vt: 30,
      },
    );

    if (readError) {
      console.error("Failed to read email batch", { queue, error: readError });
      queueReadFailures.push({ queue, error: readError.message });
      continue;
    }

    if (!messages?.length) continue;

    // Retry budget is based on real send failures, not pgmq read_ct.
    // read_ct increments for every message in a claimed batch, including
    // messages not attempted when a 429 stops processing early.
    const messageIds = Array.from(
      new Set(
        messages
          .map((msg: { message?: Record<string, unknown> }) =>
            msg?.message?.message_id &&
              typeof msg.message.message_id === "string"
              ? msg.message.message_id
              : null
          )
          .filter((id: string | null): id is string => Boolean(id)),
      ),
    );
    const failedAttemptsByMessageId = new Map<string, number>();
    if (messageIds.length > 0) {
      const { data: failedRows, error: failedRowsError } = await supabase
        .from("email_send_log")
        .select("message_id")
        .in("message_id", messageIds)
        .eq("status", "failed");

      if (failedRowsError) {
        console.error("Failed to load failed-attempt counters", {
          queue,
          error: failedRowsError,
        });
      } else {
        for (const row of failedRows ?? []) {
          const messageId = row?.message_id;
          if (typeof messageId !== "string" || !messageId) continue;
          failedAttemptsByMessageId.set(
            messageId,
            (failedAttemptsByMessageId.get(messageId) ?? 0) + 1,
          );
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const payload = msg.message;
      const provider = resolveEmailProvider({
        templateName: payload.label,
        purpose: payload.purpose,
        requestedProvider: payload.provider,
      });
      const trackedOutreach = provider === "resend";
      const failedAttempts =
        payload?.message_id && typeof payload.message_id === "string"
          ? (failedAttemptsByMessageId.get(payload.message_id) ?? 0)
          : msg.read_ct ?? 0;

      // Drop expired messages (TTL exceeded).
      // Prefer payload.queued_at when present; fall back to PGMQ's enqueued_at
      // which is always set by the queue.
      const queuedAt = payload.queued_at ?? msg.enqueued_at;
      if (queuedAt) {
        const ageMs = Date.now() - new Date(queuedAt).getTime();
        const ttlForMessage = trackedOutreach
          ? outreachTtlMinutes
          : ttlMinutes[queue];
        const maxAgeMs = ttlForMessage * 60 * 1000;
        if (ageMs > maxAgeMs) {
          console.warn("Email expired (TTL exceeded)", {
            queue,
            msg_id: msg.msg_id,
            queued_at: queuedAt,
            ttl_minutes: ttlForMessage,
          });
          await moveToDlq(
            supabase,
            queue,
            msg,
            `TTL exceeded (${ttlForMessage} minutes)`,
            trackedOutreach,
          );
          continue;
        }
      }

      // Move to DLQ if max failed send attempts reached.
      if (failedAttempts >= MAX_RETRIES) {
        await moveToDlq(
          supabase,
          queue,
          msg,
          `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`,
          trackedOutreach,
        );
        continue;
      }

      if (trackedOutreach) {
        if (typeof payload.message_id !== "string" || !payload.message_id) {
          await moveToDlq(
            supabase,
            queue,
            msg,
            "Tracked outreach has no message id",
          );
          continue;
        }

        const { data: claimState, error: claimError } = await supabase.rpc(
          "claim_tracked_email",
          {
            p_message_id: payload.message_id,
            p_stale_after_seconds: 120,
          },
        );

        if (claimError) {
          console.error("Failed to claim tracked outreach", {
            message_id: payload.message_id,
            error: claimError,
          });
          continue;
        }
        if (claimState === "busy") {
          continue;
        }
        if (claimState === "terminal") {
          const { error: terminalDeleteError } = await supabase.rpc(
            "delete_email",
            {
              queue_name: queue,
              message_id: msg.msg_id,
            },
          );
          if (terminalDeleteError) {
            console.error("Failed to delete terminal tracked email", {
              queue,
              msg_id: msg.msg_id,
              error: terminalDeleteError,
            });
          }
          continue;
        }
        if (claimState !== "claimed") {
          await moveToDlq(
            supabase,
            queue,
            msg,
            `Tracked outreach cannot be claimed (${String(claimState)})`,
          );
          continue;
        }
      } else if (payload.message_id) {
        // Legacy Lovable auth/transactional messages retain the existing sent
        // guard. Their provider also receives its own idempotency key.
        const { data: alreadySent } = await supabase
          .from("email_send_log")
          .select("id")
          .eq("message_id", payload.message_id)
          .eq("status", "sent")
          .maybeSingle();

        if (alreadySent) {
          console.warn("Skipping duplicate send (already sent)", {
            queue,
            msg_id: msg.msg_id,
            message_id: payload.message_id,
          });
          const { error: dupDelError } = await supabase.rpc("delete_email", {
            queue_name: queue,
            message_id: msg.msg_id,
          });
          if (dupDelError) {
            console.error("Failed to delete duplicate message from queue", {
              queue,
              msg_id: msg.msg_id,
              error: dupDelError,
            });
          }
          continue;
        }
      }

      let ledgerRequestKey = `email/${provider}/attempt/${
        typeof payload.message_id === "string" ? payload.message_id : msg.msg_id
      }/${msg.read_ct}`;
      let providerCallStarted = false;
      let acceptedProviderMessageId: string | null = null;
      let acceptedProviderStatus: string | null = null;

      try {
        if (provider === "resend") {
          const requiredFields = [
            "to",
            "from",
            "subject",
            "message_id",
          ] as const;
          for (const field of requiredFields) {
            if (typeof payload[field] !== "string" || !payload[field]) {
              throw new EmailProviderError(
                `Invalid outreach queue payload: ${field} is required`,
                { status: 400, code: "invalid_queue_payload" },
              );
            }
          }

          const providerIdempotencyKey =
            typeof payload.idempotency_key === "string" &&
              payload.idempotency_key
              ? payload.idempotency_key
              : payload.message_id as string;
          if (!resendApiKey) {
            throw new EmailProviderError("RESEND_API_KEY is not configured", {
              status: 503,
              code: "missing_api_key",
            });
          }
          if (providerIdempotencyKey.length > 256) {
            throw new EmailProviderError("Invalid Resend idempotency key", {
              status: 400,
              code: "invalid_idempotency_key",
            });
          }

          providerCallStarted = true;
          const providerResult = await sendResendEmail(
            {
              to: payload.to as string,
              from: payload.from as string,
              subject: payload.subject as string,
              html: typeof payload.html === "string" ? payload.html : undefined,
              text: typeof payload.text === "string" ? payload.text : undefined,
              replyTo: typeof payload.reply_to === "string"
                ? payload.reply_to
                : undefined,
              idempotencyKey: providerIdempotencyKey,
            },
            resendApiKey,
          );
          acceptedProviderMessageId = providerResult.id;
          ledgerRequestKey = `email/resend/accepted/${providerResult.id}`;

          const ledgerPersisted = await persistProviderUsage(supabase, {
            provider,
            requestKey: ledgerRequestKey,
            queueMessageId: payload.message_id as string,
            providerMessageId: providerResult.id,
            templateName: typeof payload.label === "string"
              ? payload.label
              : "outreach-message",
            signalId: typeof payload.signal_id === "string"
              ? payload.signal_id
              : null,
            contactId: typeof payload.contact_id === "string"
              ? payload.contact_id
              : null,
            success: true,
            units: 1,
            errorCode: null,
            httpStatus: providerResult.httpStatus,
          });
          if (!ledgerPersisted) {
            return new Response(
              JSON.stringify({
                processed: totalProcessed,
                stopped: "ledger_persistence_failed",
                provider,
                request_key: ledgerRequestKey,
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }

          const { data: completed, error: completionError } = await supabase
            .rpc(
              "complete_tracked_email",
              {
                p_message_id: payload.message_id,
                p_provider_message_id: providerResult.id,
              },
            );
          if (completionError || completed !== true) {
            // The provider has accepted the message. Never convert that fact to
            // `failed` and never delete the queue item: the next claim retries
            // with the same Resend idempotency key and receives the same id.
            console.error(
              "Provider accepted outreach but local completion failed",
              {
                message_id: payload.message_id,
                error: completionError ?? "tracked email not found",
              },
            );
            return new Response(
              JSON.stringify({
                processed: totalProcessed,
                stopped: "send_state_persistence_failed",
                provider,
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }
        } else {
          if (!lovableApiKey) {
            throw new Error("LOVABLE_API_KEY is not configured");
          }
          const lovableIdempotencyKey =
            typeof payload.idempotency_key === "string" &&
              payload.idempotency_key
              ? payload.idempotency_key
              : (typeof payload.run_id === "string" && payload.run_id
                ? payload.run_id
                : payload.message_id);
          if (
            typeof lovableIdempotencyKey !== "string" || !lovableIdempotencyKey
          ) {
            throw new EmailProviderError(
              "Invalid Lovable queue payload: idempotency key is required",
              { status: 400, code: "invalid_queue_payload" },
            );
          }
          providerCallStarted = true;
          const lovableResult = await sendLovableEmail(
            {
              run_id: payload.run_id,
              to: payload.to,
              from: payload.from,
              sender_domain: payload.sender_domain,
              subject: payload.subject,
              html: payload.html,
              text: payload.text,
              reply_to: payload.reply_to,
              purpose: payload.purpose,
              label: payload.label,
              idempotency_key: lovableIdempotencyKey,
              unsubscribe_token: payload.unsubscribe_token,
              message_id: payload.message_id,
            },
            // Lovable remains the auth/transactional provider only.
            {
              apiKey: lovableApiKey,
              sendUrl: Deno.env.get("LOVABLE_SEND_URL"),
              idempotencyKey: lovableIdempotencyKey,
            },
          );
          acceptedProviderMessageId = lovableResult.message_id ?? null;
          acceptedProviderStatus = lovableResult.status ?? null;
          ledgerRequestKey =
            `email/lovable_email/accepted/${lovableIdempotencyKey}`;
          if (lovableResult.success !== true) {
            throw new EmailProviderError("Lovable did not accept the email", {
              status: 502,
              code: "provider_not_accepted",
            });
          }

          const ledgerPersisted = await persistProviderUsage(supabase, {
            provider,
            requestKey: ledgerRequestKey,
            queueMessageId: typeof payload.message_id === "string"
              ? payload.message_id
              : null,
            providerMessageId: lovableResult.message_id ?? null,
            templateName: typeof payload.label === "string"
              ? payload.label
              : queue,
            signalId: typeof payload.signal_id === "string"
              ? payload.signal_id
              : null,
            contactId: typeof payload.contact_id === "string"
              ? payload.contact_id
              : null,
            success: true,
            units: 1,
            errorCode: null,
            providerStatus: lovableResult.status ?? null,
          });
          if (!ledgerPersisted) {
            return new Response(
              JSON.stringify({
                processed: totalProcessed,
                stopped: "ledger_persistence_failed",
                provider,
                request_key: ledgerRequestKey,
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }

          const { error: sendLogError } = await supabase.from("email_send_log")
            .insert({
              message_id: payload.message_id,
              template_name: payload.label || queue,
              recipient_email: payload.to,
              status: "sent",
            });
          if (sendLogError) {
            console.error(
              "Provider accepted Lovable email but send log failed",
              {
                message_id: payload.message_id,
                error: sendLogError,
              },
            );
            return new Response(
              JSON.stringify({
                processed: totalProcessed,
                stopped: "send_state_persistence_failed",
                provider,
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }
        }

        // Delete from queue
        const { error: delError } = await supabase.rpc("delete_email", {
          queue_name: queue,
          message_id: msg.msg_id,
        });
        if (delError) {
          console.error("Failed to delete sent message from queue", {
            queue,
            msg_id: msg.msg_id,
            error: delError,
          });
        }
        totalProcessed++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Email send failed", {
          queue,
          msg_id: msg.msg_id,
          read_ct: msg.read_ct,
          failed_attempts: failedAttempts,
          error: errorMsg,
        });

        if (providerCallStarted) {
          const ledgerPersisted = await persistProviderUsage(supabase, {
            provider,
            requestKey: ledgerRequestKey,
            queueMessageId: typeof payload.message_id === "string"
              ? payload.message_id
              : null,
            providerMessageId: acceptedProviderMessageId,
            templateName: typeof payload.label === "string"
              ? payload.label
              : queue,
            signalId: typeof payload.signal_id === "string"
              ? payload.signal_id
              : null,
            contactId: typeof payload.contact_id === "string"
              ? payload.contact_id
              : null,
            success: false,
            units: 0,
            errorCode: providerErrorCode(error),
            httpStatus: providerHttpStatus(error),
            providerStatus: acceptedProviderStatus,
          });
          if (!ledgerPersisted) {
            return new Response(
              JSON.stringify({
                processed: totalProcessed,
                stopped: "ledger_persistence_failed",
                provider,
                request_key: ledgerRequestKey,
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }
        }

        if (trackedOutreach && typeof payload.message_id === "string") {
          const { error: trackingError } = await supabase.rpc(
            "fail_tracked_email",
            {
              p_message_id: payload.message_id,
              p_error_message: errorMsg.slice(0, 1000),
            },
          );
          if (trackingError) {
            console.error("Failed to persist tracked outreach failure", {
              message_id: payload.message_id,
              error: trackingError,
            });
          }
        }

        if (isRateLimited(error)) {
          await supabase.from("email_send_log").insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: "rate_limited",
            error_message: errorMsg.slice(0, 1000),
          });

          const retryAfterSecs = getRetryAfterSeconds(error);
          await supabase
            .from("email_send_state")
            .update({
              retry_after_until: new Date(
                Date.now() + retryAfterSecs * 1000,
              ).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);

          // Stop processing — remaining messages stay in queue (VT expires, retried next cycle)
          return new Response(
            JSON.stringify({
              processed: totalProcessed,
              stopped: "rate_limited",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        // Invalid payloads/credentials are not made healthier by retrying.
        // Configuration-wide 401/403 errors stop this run; a bad recipient only
        // moves its own message to DLQ.
        if (isPermanentProviderFailure(error)) {
          await moveToDlq(
            supabase,
            queue,
            msg,
            errorMsg.slice(0, 1000),
            trackedOutreach,
          );
          const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status: unknown }).status)
            : null;
          if (status === 401 || status === 403 || isForbidden(error)) {
            return new Response(
              JSON.stringify({
                processed: totalProcessed,
                stopped: "provider_configuration",
              }),
              { headers: { "Content-Type": "application/json" } },
            );
          }
          continue;
        }

        // Log non-429 failures to track real retry attempts.
        await supabase.from("email_send_log").insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: "failed",
          error_message: errorMsg.slice(0, 1000),
        });
        if (payload?.message_id && typeof payload.message_id === "string") {
          failedAttemptsByMessageId.set(payload.message_id, failedAttempts + 1);
        }

        // Non-429 errors: message stays invisible until VT expires, then retried
      }

      // Small delay between sends to smooth bursts
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, sendDelayMs));
      }
    }
  }

  return new Response(
    JSON.stringify({
      processed: totalProcessed,
      partial: queueReadFailures.length > 0,
      queue_read_failures: queueReadFailures,
    }),
    {
      status: queueReadFailures.length > 0 ? 503 : 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
