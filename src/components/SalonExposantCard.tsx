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
  ExternalLink
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

interface SalonExposantCardProps {
  exposant: SalonExposant;
  onStatusChange?: (id: string, status: string) => void;
}

const OUTREACH_STATUS_OPTIONS = [
  { value: 'new', label: 'Nouveau', color: 'bg-gray-100 text-gray-700' },
  { value: 'to_contact', label: 'À contacter', color: 'bg-blue-100 text-blue-700' },
  { value: 'contacted', label: 'Contacté', color: 'bg-amber-100 text-amber-700' },
  { value: 'meeting', label: 'RDV pris', color: 'bg-purple-100 text-purple-700' },
  { value: 'converted', label: 'Converti', color: 'bg-green-100 text-green-700' },
  { value: 'not_interested', label: 'Pas intéressé', color: 'bg-red-100 text-red-700' },
];

export function SalonExposantCard({ exposant, onStatusChange }: SalonExposantCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const currentStatus = OUTREACH_STATUS_OPTIONS.find(s => s.value === exposant.outreach_status) 
    || OUTREACH_STATUS_OPTIONS[0];

  return (
    <Card className={cn(
      "overflow-hidden transition-all duration-300 hover:shadow-xl rounded-3xl border-0 shadow-lg shadow-black/[0.03]",
      exposant.is_priority && "ring-2 ring-pink-400/50"
    )}>
      {/* Header gradient */}
      <div className="h-2 bg-gradient-to-r from-pink-400 via-rose-400 to-pink-500" />
      
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {exposant.is_priority && (
                <Star className="h-4 w-4 text-pink-500 fill-pink-500" />
              )}
              <h3 className="font-display font-bold text-lg text-foreground truncate">
                {exposant.company_name}
              </h3>
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
            value={exposant.outreach_status || 'new'}
            onValueChange={(value) => onStatusChange?.(exposant.id, value)}
          >
            <SelectTrigger className={cn("w-[130px] h-8 text-xs font-medium border-0", currentStatus.color)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTREACH_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
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

        {/* Social links */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          {exposant.website_url && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => window.open(exposant.website_url!, '_blank')}
            >
              <Globe className="h-3.5 w-3.5" />
              Site web
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          {exposant.linkedin_url && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={() => window.open(exposant.linkedin_url!, '_blank')}
            >
              <Linkedin className="h-3.5 w-3.5" />
            </Button>
          )}
          {exposant.instagram_url && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-pink-600 border-pink-200 hover:bg-pink-50"
              onClick={() => window.open(exposant.instagram_url!, '_blank')}
            >
              <Instagram className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Booth number */}
        {exposant.booth_number && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Stand: {exposant.booth_number}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
