import type { ComponentType } from 'npm:react@18.3.1'
import { template as outreachMessage } from './outreach-message.tsx'

export interface TemplateEntry {
  // deno-lint-ignore no-explicit-any
  component: ComponentType<any>
  subject: string | ((data: Record<string, unknown>) => string)
  displayName?: string
  previewData?: Record<string, unknown>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'outreach-message': outreachMessage,
}
