import { z } from 'zod';

export const COMPANY_FEEDBACK = [
  { value: 'read', label: 'Lu' },
  { value: 'deleted_unread', label: 'Supprimé sans être lu' },
  { value: 'not_interested', label: 'Retour pas intéressé' },
  { value: 'interested', label: 'Retour intéressé' },
  { value: 'sample_requested', label: 'Demande d’échantillon' },
  { value: 'order_in_progress', label: 'Commande en cours' },
] as const;
export type CompanyFeedback = typeof COMPANY_FEEDBACK[number]['value'];
export const feedbackSchema = z.enum(['read', 'deleted_unread', 'not_interested', 'interested', 'sample_requested', 'order_in_progress']);
export const contactedSignalSchema = z.object({
  signal_id: z.string(), company_name: z.string(), signal_type: z.string(),
  source_name: z.string().nullable(), status: z.string().nullable(), event_detail: z.string().nullable(),
  first_contacted_at: z.string().nullable(), last_contacted_at: z.string().nullable(),
  channels: z.array(z.enum(['email', 'linkedin', 'unknown'])),
  feedback: feedbackSchema.nullable(), feedback_updated_at: z.string().nullable(),
  contacted_contacts: z.array(z.object({ id: z.string(), name: z.string(), job_title: z.string().nullable() })),
  email_recipients: z.array(z.string()), has_bounced_email: z.boolean().nullable(),
});
export const contactedPageSchema = z.object({ items: z.array(contactedSignalSchema), total_count: z.number() });
export type ContactedSignal = z.infer<typeof contactedSignalSchema>;

const parisParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(date).map(part => [part.type, part.value]));
export function parisToday(date = new Date()): string {
  const parts = parisParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
// Calendar boundaries are Paris midnight, not browser-local midnight; DST days
// deliberately have 23/25 hours. End date remains inclusive in the UI.
export function parisMidnight(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Date invalide');
  const target = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day) throw new Error('Date invalide');
  let timestamp = target;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    const displayed = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    timestamp += target - displayed;
  }
  return new Date(timestamp).toISOString();
}
export function contactDateBounds(from: string, to: string) {
  if (from && to && from > to) throw new Error('La date de fin doit suivre la date de début.');
  return { from: from ? parisMidnight(from) : null, until: to ? parisMidnight(shiftDay(to, 1)) : null };
}
export function contactPeriod(period: string, now = new Date()): { from: string; to: string } {
  const today = parisToday(now);
  if (period === 'today') return { from: today, to: today };
  if (period === '7days') return { from: shiftDay(today, -6), to: today };
  if (period === '30days') return { from: shiftDay(today, -29), to: today };
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: '', to: '' };
}