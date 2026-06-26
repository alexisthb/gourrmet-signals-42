import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Attachment {
  filename: string
  url: string
}

interface OutreachMessageProps {
  subject?: string
  bodyHtml?: string
  senderName?: string
  recipientFirstName?: string
  signalCompany?: string
  unsubscribeUrl?: string
  attachments?: Attachment[]
}

const OutreachMessage = ({
  subject = 'Une attention de la part de GOURЯMET',
  bodyHtml = '',
  senderName = 'Clotilde Gautier',
  recipientFirstName,
  signalCompany,
  unsubscribeUrl,
  attachments = [],
}: OutreachMessageProps) => {
  const greeting = recipientFirstName ? `Bonjour ${recipientFirstName},` : 'Bonjour,'

  return (
    <Html lang="fr" dir="ltr">
      <Head />
      <Preview>{subject}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={brand}>GOURЯMET</Heading>

          <Section style={section}>
            <Text style={text}>{greeting}</Text>
            {/* bodyHtml provient de notre IA serveur — source de confiance */}
            <div
              style={bodyStyle}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />

            {attachments && attachments.length > 0 ? (
              <Section style={attachmentBox}>
                <Text style={attachmentTitle}>Pièce jointe</Text>
                {attachments.map((att) => (
                  <Button key={att.url} href={att.url} style={attachmentLink}>
                    Télécharger {att.filename}
                  </Button>
                ))}
              </Section>
            ) : null}

            <Text style={signature}>
              Bien à vous,
              <br />
              {senderName}
              <br />
              <span style={role}>GOURЯMET</span>
            </Text>
          </Section>

          <Hr style={hr} />
          {signalCompany ? (
            <Text style={footnote}>
              Vous recevez ce message car nous avons identifié une actualité concernant{' '}
              <strong>{signalCompany}</strong>.
            </Text>
          ) : null}
          {/* RGPD : lien de désinscription obligatoire (one-click) */}
          <Text style={footnote}>
            GOURЯMET · notify.gourrmet.com
            {unsubscribeUrl ? (
              <>
                {' · '}
                <a href={unsubscribeUrl} style={unsubLink}>
                  Se désinscrire
                </a>
              </>
            ) : null}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: OutreachMessage,
  subject: (data: Record<string, unknown>) =>
    (data.subject as string) || 'Une attention de la part de GOURЯMET',
  displayName: 'Message de prospection',
  previewData: {
    subject: 'Félicitations pour votre nouvelle levée',
    bodyHtml: '<p>Toutes nos félicitations pour cette belle annonce…</p>',
    senderName: 'Clotilde Gautier',
    recipientFirstName: 'Marie',
    signalCompany: 'Acme SAS',
    attachments: [],
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Poppins, Helvetica, Arial, sans-serif',
  color: '#1a1a1a',
}
const container = { padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }
const brand = {
  fontFamily: 'Montserrat, Helvetica, Arial, sans-serif',
  fontSize: '28px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#E8735A',
  margin: '0 0 24px',
}
const section = { padding: '0' }
const text = { fontSize: '15px', lineHeight: '1.6', margin: '0 0 16px' }
const bodyStyle = { fontSize: '15px', lineHeight: '1.7', color: '#1a1a1a' }
const signature = { fontSize: '15px', lineHeight: '1.6', marginTop: '24px' }
const role = { color: '#6b6b6b', fontSize: '13px' }
const hr = { borderColor: '#eee', margin: '32px 0 16px' }
const footnote = { fontSize: '12px', color: '#6b6b6b', lineHeight: '1.5' }
const unsubLink = { color: '#6b6b6b', textDecoration: 'underline' }
const attachmentBox = {
  margin: '20px 0',
  padding: '16px',
  backgroundColor: '#FAF7F2',
  borderRadius: '12px',
}
const attachmentTitle = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#6b6b6b',
  margin: '0 0 8px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
}
const attachmentLink = {
  backgroundColor: '#E8735A',
  color: '#ffffff',
  padding: '10px 18px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 500,
  textDecoration: 'none',
}
