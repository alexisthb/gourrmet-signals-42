import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Building2, 
  User, 
  Mail, 
  Phone, 
  Globe, 
  Linkedin, 
  Instagram,
  MapPin,
  Star,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  Award
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SalonExposant } from '@/hooks/useSalonMariage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LinkedInMessageDialog } from './LinkedInMessageDialog';
import { toast } from 'sonner';

interface SalonExposantCardProps {
  exposant: SalonExposant;
  onStatusChange?: (id: string, status: string) => void;
}

// Workflow complet de prospection salon
const OUTREACH_STATUS_OPTIONS = [
  { value: 'not_contacted', label: 'Non contacté', color: 'bg-gray-100 text-gray-700', icon: '⚪' },
  { value: 'researched', label: 'Recherché', color: 'bg-blue-100 text-blue-700', icon: '🔍' },
  { value: 'contacted', label: 'Contacté', color: 'bg-amber-100 text-amber-700', icon: '📨' },
  { value: 'met_at_event', label: 'Rencontré', color: 'bg-purple-100 text-purple-700', icon: '🤝' },
  { value: 'demo_scheduled', label: 'RDV planifié', color: 'bg-indigo-100 text-indigo-700', icon: '📅' },
  { value: 'follow_up_sent', label: 'Relance envoyée', color: 'bg-cyan-100 text-cyan-700', icon: '✉️' },
  { value: 'proposal_sent', label: 'Proposition', color: 'bg-orange-100 text-orange-700', icon: '📋' },
  { value: 'converted', label: 'Converti', color: 'bg-green-100 text-green-700', icon: '✅' },
  { value: 'not_interested', label: 'Pas intéressé', color: 'bg-red-100 text-red-700', icon: '❌' },
];

const TIER_CONFIG: Record<number, { label: string; color: string; icon: string }> = {
  1: { label: 'Tier 1', color: 'bg-emerald-100 text-emerald-700 border-emerald-300', icon: '🏆' },
  2: { label: 'Tier 2', color: 'bg-blue-100 text-blue-700 border-blue-300', icon: '🥈' },
  3: { label: 'Tier 3', color: 'bg-amber-100 text-amber-700 border-amber-300', icon: '🥉' },
  4: { label: 'Tier 4', color: 'bg-gray-100 text-gray-600 border-gray-300', icon: '📌' },
};

export function SalonExposantCard({ exposant, onStatusChange }: SalonExposantCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [linkedInDialogOpen, setLinkedInDialogOpen] = useState(false);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`${field === 'email' ? 'Email' : 'Téléphone'} copié !`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const currentStatus = OUTREACH_STATUS_OPTIONS.find(s => s.value === exposant.outreach_status) 
    || OUTREACH_STATUS_OPTIONS[0];

  const tierConfig = TIER_CONFIG[exposant.tier || 4];
  const firstName = exposant.contact_name?.split(' ')[0] || '';

  return (
    <>
      <Card className={cn(
        "overflow-hidden transition-all duration-300 hover:shadow-xl rounded-3xl border-0 shadow-lg shadow-black/[0.03] flex flex-col h-full",
        exposant.is_priority && "ring-2 ring-pink-400/50"
      )}>
        {/* Header gradient based on tier */}
        <div className={cn(
          "h-2 shrink-0",
          exposant.tier === 1 && "bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500",
          exposant.tier === 2 && "bg-gradient-to-r from-blue-400 via-indigo-400 to-blue-500",
          exposant.tier === 3 && "bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500",
          (!exposant.tier || exposant.tier === 4) && "bg-gradient-to-r from-pink-400 via-rose-400 to-pink-500"
        )} />
        
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {exposant.is_priority && (
                  <Star className="h-4 w-4 text-pink-500 fill-pink-500 shrink-0" />
                )}
                <h3 className="font-display font-bold text-lg text-foreground">
                  {exposant.company_name}
                </h3>
                {tierConfig && (
                  <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", tierConfig.color)}>
                    {tierConfig.icon} {tierConfig.label}
                  </Badge>
                )}
              </div>
              {exposant.contact_name && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  {exposant.contact_name}
                  {exposant.job_title && (
                    <span className="text-muted-foreground/70">• {exposant.job_title}</span>
                  )}
                </p>
              )}
              {exposant.location && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <MapPin className="h-3 w-3" />
                  {exposant.location}
                </p>
              )}
            </div>

            <Select
              value={exposant.outreach_status || 'not_contacted'}
              onValueChange={(value) => onStatusChange?.(exposant.id, value)}
            >
              <SelectTrigger className={cn("w-[140px] h-8 text-xs font-medium border-0", currentStatus.color)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTREACH_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-1.5">
                      <span>{option.icon}</span>
                      {option.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col flex-1">
          {/* Content section - grows to fill available space */}
          <div className="flex-1 space-y-3">
            {/* Specialties */}
            {exposant.specialties && exposant.specialties.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {exposant.specialties.map((specialty, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs bg-pink-50 text-pink-700 border-pink-200">
                    {specialty}
                  </Badge>
                ))}
              </div>
            )}

            {/* Description */}
            {exposant.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {exposant.description}
              </p>
            )}

            {/* Contact info */}
            <div className="space-y-2">
              {exposant.email && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="h-4 w-4 text-pink-500 shrink-0" />
                    <span className="text-sm truncate">{exposant.email}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(exposant.email!, 'email')}
                  >
                    {copiedField === 'email' ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}

              {exposant.phone && (
                <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Phone className="h-4 w-4 text-pink-500 shrink-0" />
                    <span className="text-sm truncate">{exposant.phone}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(exposant.phone!, 'phone')}
                  >
                    {copiedField === 'phone' ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Booth number */}
            {exposant.booth_number && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Stand: {exposant.booth_number}
              </div>
            )}
          </div>

          {/* Action buttons - always at bottom */}
          <div className="flex items-center gap-2 pt-3 mt-3 border-t border-border/50 shrink-0">
            {exposant.linkedin_url && (
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 text-xs bg-[#0077B5] hover:bg-[#005885]"
                onClick={() => setLinkedInDialogOpen(true)}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Contacter
              </Button>
            )}

            {exposant.website_url && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => window.open(exposant.website_url!, '_blank')}
              >
                <Globe className="h-3.5 w-3.5" />
                Site
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
            
            {exposant.linkedin_url && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 text-blue-600 border-blue-200 hover:bg-blue-50"
                onClick={() => window.open(exposant.linkedin_url!, '_blank')}
              >
                <Linkedin className="h-3.5 w-3.5" />
              </Button>
            )}
            
            {exposant.instagram_url && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 text-pink-600 border-pink-200 hover:bg-pink-50"
                onClick={() => window.open(exposant.instagram_url!, '_blank')}
              >
                <Instagram className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* LinkedIn Message Dialog */}
      {exposant.linkedin_url && (
        <LinkedInMessageDialog
          open={linkedInDialogOpen}
          onOpenChange={setLinkedInDialogOpen}
          linkedinUrl={exposant.linkedin_url}
          recipientName={exposant.contact_name || exposant.company_name}
          companyName={exposant.company_name}
          eventDetail="Salon du Mariage Paris 2026"
          jobTitle={exposant.job_title || undefined}
        />
      )}
    </>
  );
}
