import { useState, useEffect } from 'react';
import { Plus, X, Star, Users, Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSettings, useUpdateSetting } from '@/hooks/useSettings';

interface Persona {
  name: string;
  isPriority: boolean;
}

interface PersonaConfigCardProps {
  scannerType: 'presse' | 'pappers' | 'linkedin';
  title?: string;
  description?: string;
}

// Default personas for GOURЯMET (Executive Assistants, Office Managers are priority)
const DEFAULT_PERSONAS: Persona[] = [
  { name: 'Assistant(e) de direction', isPriority: true },
  { name: 'Office Manager', isPriority: true },
  { name: 'Responsable RH', isPriority: false },
  { name: 'Directeur Général', isPriority: false },
  { name: 'DAF / CFO', isPriority: false },
  { name: 'Responsable Communication', isPriority: false },
  { name: 'Responsable Achats', isPriority: false },
];

export function PersonaConfigCard({ scannerType, title, description }: PersonaConfigCardProps) {
  const { toast } = useToast();
  const { data: settings, isLoading } = useSettings();
  const updateSetting = useUpdateSetting();
  
  const settingKey = `personas_${scannerType}`;
  
  const [personas, setPersonas] = useState<Persona[]>(DEFAULT_PERSONAS);
  const [newPersona, setNewPersona] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Sync state with settings when data loads
  useEffect(() => {
    if (settings && settings[settingKey]) {
      try {
        const parsed = JSON.parse(settings[settingKey]);
        setPersonas(parsed);
        setHasChanges(false);
      } catch (e) {
        console.error('Error parsing personas setting:', e);
      }
    }
  }, [settings, settingKey]);
  
  const handleTogglePriority = (index: number) => {
    const updated = [...personas];
    updated[index].isPriority = !updated[index].isPriority;
    setPersonas(updated);
    setHasChanges(true);
  };
  
  const handleRemovePersona = (index: number) => {
    const updated = personas.filter((_, i) => i !== index);
    setPersonas(updated);
    setHasChanges(true);
  };
  
  const handleAddPersona = () => {
    if (!newPersona.trim()) return;
    
    // Check for duplicates
    if (personas.some(p => p.name.toLowerCase() === newPersona.trim().toLowerCase())) {
      toast({ title: 'Ce persona existe déjà', variant: 'destructive' });
      return;
    }
    
    setPersonas([...personas, { name: newPersona.trim(), isPriority: false }]);
    setNewPersona('');
    setIsAddingNew(false);
    setHasChanges(true);
  };
  
  const handleSave = async () => {
    try {
      await updateSetting.mutateAsync({
        key: settingKey,
        value: JSON.stringify(personas),
      });
      setHasChanges(false);
      toast({ title: 'Personas sauvegardés ✓' });
    } catch (error) {
      console.error('Error saving personas:', error);
      toast({ title: 'Erreur lors de la sauvegarde', variant: 'destructive' });
    }
  };
  
  const priorityPersonas = personas.filter(p => p.isPriority);
  const otherPersonas = personas.filter(p => !p.isPriority);
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {title || 'Types de personas cibles'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-muted rounded w-1/2"></div>
            <div className="h-8 bg-muted rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          {title || 'Types de personas cibles'}
        </CardTitle>
        <CardDescription>
          {description || "Profils à rechercher lors de l'enrichissement des contacts"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Priority personas */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
            <span className="text-sm font-medium">Prioritaires</span>
            <Badge variant="secondary" className="text-xs">Mise en avant</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {priorityPersonas.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Aucun persona prioritaire</p>
            ) : (
              priorityPersonas.map((persona) => {
                const originalIndex = personas.findIndex(p => p.name === persona.name);
                return (
                  <div 
                    key={persona.name} 
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-amber-500/10 border-amber-500/30"
                  >
                    <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                    <span className="text-sm">{persona.name}</span>
                    <button 
                      onClick={() => handleTogglePriority(originalIndex)}
                      className="text-muted-foreground hover:text-foreground ml-1 transition-colors"
                      title="Retirer priorité"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        
        {/* Other personas */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Autres profils ciblés</span>
            {!isAddingNew && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setIsAddingNew(true)}
                className="h-7 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                Ajouter
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {otherPersonas.map((persona) => {
              const originalIndex = personas.findIndex(p => p.name === persona.name);
              return (
                <div 
                  key={persona.name}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted group transition-colors"
                >
                  <span className="text-sm">{persona.name}</span>
                  <button 
                    onClick={() => handleTogglePriority(originalIndex)}
                    className="text-muted-foreground hover:text-amber-500 ml-1 transition-colors"
                    title="Rendre prioritaire"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                  <button 
                    onClick={() => handleRemovePersona(originalIndex)}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                    title="Supprimer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            
            {otherPersonas.length === 0 && !isAddingNew && (
              <p className="text-sm text-muted-foreground italic">Aucun autre profil configuré</p>
            )}
            
            {/* Add new persona input */}
            {isAddingNew && (
              <div className="flex items-center gap-1">
                <Input
                  value={newPersona}
                  onChange={(e) => setNewPersona(e.target.value)}
                  placeholder="Ex: DRH, CEO..."
                  className="h-8 w-40 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddPersona();
                    if (e.key === 'Escape') {
                      setIsAddingNew(false);
                      setNewPersona('');
                    }
                  }}
                />
                <Button size="sm" className="h-8 w-8 p-0" onClick={handleAddPersona}>
                  <Check className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => {
                  setIsAddingNew(false);
                  setNewPersona('');
                }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
        
        {/* Save button - only show if changes exist */}
        {hasChanges && (
          <div className="pt-2 border-t">
            <Button 
              onClick={handleSave} 
              disabled={updateSetting.isPending}
              className="w-full sm:w-auto"
            >
              {updateSetting.isPending ? (
                <>Sauvegarde...</>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Sauvegarder les modifications
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
