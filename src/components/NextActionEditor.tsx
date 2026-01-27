import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, Check, X, Edit3, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useUpdateNextAction } from '@/hooks/useContactInteractions';
import { toast } from '@/hooks/use-toast';

interface NextActionEditorProps {
  contactId: string;
  currentDate?: string | null;
  currentNote?: string | null;
}

export function NextActionEditor({ contactId, currentDate, currentNote }: NextActionEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [date, setDate] = useState<Date | undefined>(currentDate ? new Date(currentDate) : undefined);
  const [note, setNote] = useState(currentNote || '');
  const [calendarOpen, setCalendarOpen] = useState(false);
  
  const updateNextAction = useUpdateNextAction();

  const handleSave = async () => {
    try {
      await updateNextAction.mutateAsync({
        contactId,
        nextActionAt: date?.toISOString() || null,
        nextActionNote: note || null,
      });
      setIsEditing(false);
      toast({
        title: "Prochaine action enregistrée",
        description: date ? `Programmée pour le ${format(date, 'dd MMMM yyyy', { locale: fr })}` : "Action supprimée",
      });
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible d'enregistrer l'action",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setDate(currentDate ? new Date(currentDate) : undefined);
    setNote(currentNote || '');
    setIsEditing(false);
  };

  if (!isEditing) {
    if (!currentDate && !currentNote) {
      return (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(true)}
          className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-primary"
        >
          <Calendar className="h-3 w-3" />
          Planifier une action
        </Button>
      );
    }

    return (
      <div 
        onClick={() => setIsEditing(true)}
        className="flex items-center gap-2 p-2 bg-accent/10 border border-accent/20 rounded-xl cursor-pointer hover:bg-accent/20 transition-colors group"
      >
        <Calendar className="h-4 w-4 text-accent flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {currentDate && (
            <div className="text-xs font-semibold text-accent">
              {format(new Date(currentDate), 'dd MMM yyyy', { locale: fr })}
            </div>
          )}
          {currentNote && (
            <div className="text-xs text-muted-foreground truncate">{currentNote}</div>
          )}
        </div>
        <Edit3 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2 bg-muted/30 rounded-xl border border-border/50">
      <div className="flex items-center gap-2">
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 text-xs justify-start gap-1.5 flex-1",
                !date && "text-muted-foreground"
              )}
            >
              <Calendar className="h-3 w-3" />
              {date ? format(date, 'dd/MM/yyyy', { locale: fr }) : "Choisir une date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              mode="single"
              selected={date}
              onSelect={(d) => {
                setDate(d);
                setCalendarOpen(false);
              }}
              disabled={(d) => d < new Date()}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note sur la prochaine action..."
        className="h-8 text-xs"
      />
      
      <div className="flex items-center gap-1.5 justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="h-7 text-xs gap-1"
        >
          <X className="h-3 w-3" />
          Annuler
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateNextAction.isPending}
          className="h-7 text-xs gap-1"
        >
          {updateNextAction.isPending ? (
            <Clock className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
