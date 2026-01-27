import { useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, Check, X, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useUpdateSignalNextAction } from '@/hooks/useSignalInteractions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SignalNextActionEditorProps {
  signalId: string;
  currentDate?: string | null;
  currentNote?: string | null;
}

export function SignalNextActionEditor({ 
  signalId, 
  currentDate, 
  currentNote 
}: SignalNextActionEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    currentDate ? new Date(currentDate) : undefined
  );
  const [note, setNote] = useState(currentNote || '');
  const [calendarOpen, setCalendarOpen] = useState(false);

  const updateNextAction = useUpdateSignalNextAction();

  const handleSave = async () => {
    try {
      await updateNextAction.mutateAsync({
        signalId,
        nextActionAt: selectedDate?.toISOString() || null,
        nextActionNote: note || null,
      });
      toast.success('Prochaine action mise à jour');
      setIsEditing(false);
    } catch (error) {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const handleCancel = () => {
    setSelectedDate(currentDate ? new Date(currentDate) : undefined);
    setNote(currentNote || '');
    setIsEditing(false);
  };

  if (!isEditing && !currentDate && !currentNote) {
    return (
      <Button 
        variant="ghost" 
        size="sm" 
        className="text-xs h-7 text-muted-foreground hover:text-foreground"
        onClick={() => setIsEditing(true)}
      >
        <Clock className="h-3 w-3 mr-1" />
        Planifier une action
      </Button>
    );
  }

  if (!isEditing) {
    return (
      <div 
        className="bg-muted/50 rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors"
        onClick={() => setIsEditing(true)}
      >
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <span className="font-medium">
            {currentDate 
              ? format(new Date(currentDate), "d MMM yyyy", { locale: fr })
              : 'Date non définie'
            }
          </span>
        </div>
        {currentNote && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {currentNote}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 text-xs justify-start",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              {selectedDate 
                ? format(selectedDate, "d MMM yyyy", { locale: fr })
                : "Choisir une date"
              }
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                setSelectedDate(date);
                setCalendarOpen(false);
              }}
              locale={fr}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note sur l'action à effectuer..."
        className="h-8 text-xs"
      />
      
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSave}
          disabled={updateNextAction.isPending}
        >
          <Check className="h-3 w-3 mr-1" />
          Enregistrer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleCancel}
        >
          <X className="h-3 w-3 mr-1" />
          Annuler
        </Button>
      </div>
    </div>
  );
}
