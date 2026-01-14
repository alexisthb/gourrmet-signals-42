import { useState } from 'react';
import { Plus, X, Star, Users, Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useSettings, useUpdateSetting } from '@/hooks/useSettings';

interface PersonaConfigCardProps {
  scannerType: 'presse' | 'pappers' | 'linkedin';
  title?: string;
  description?: string;
}

// Default personas for GOURЯMET (Executive Assistants, Office Managers are priority)
const DEFAULT_PERSONAS = [
  { name: 'Assistant(e) de direction', isPriority: true, color: 'amber' },
  { name: 'Office Manager', isPriority: true, color: 'violet' },
  { name: 'Responsable RH', isPriority: false, color: 'blue' },
  { name: 'Directeur Général', isPriority: false, color: 'emerald' },
  { name: 'DAF / CFO', isPriority: false, color: 'cyan' },
  { name: 'Responsable Communication', isPriority: false, color: 'pink' },
  { name: 'Responsable Achats', isPriority: false, color: 'orange' },
];

export function PersonaConfigCard({ scannerType, title, description }: PersonaConfigCardProps) {
  const { toast } = useToast();
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();
  
  const settingKey = `personas_${scannerType}`;
  
  // Parse personas from settings or use defaults
  const savedPersonas = settings?.[settingKey] 
    ? JSON.parse(settings[settingKey]) 
    : DEFAULT_PERSONAS;
  
  const [personas, setPersonas] = useState<typeof DEFAULT_PERSONAS>(savedPersonas);
  const [newPersona, setNewPersona] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  
  const handleTogglePriority = (index: number) => {
    const updated = [...personas];
    updated[index].isPriority = !updated[index].isPriority;
    setPersonas(updated);
  };
  
  const handleRemovePersona = (index: number) => {
    const updated = personas.filter((_, i) => i !== index);
    setPersonas(updated);
  };
  
  const handleAddPersona = () => {
    if (!newPersona.trim()) return;
    setPersonas([...personas, { name: newPersona.trim(), isPriority: false, color: 'gray' }]);
    setNewPersona('');
    setIsAddingNew(false);
  };
  
  const handleSave = async () => {
    try {
      await updateSetting.mutateAsync({
        key: settingKey,
        value: JSON.stringify(personas),
      });
      toast({ title: 'Personas sauvegardés' });
    } catch (error) {
      toast({ title: 'Erreur', variant: 'destructive' });
    }
  };
  
  const priorityPersonas = personas.filter(p => p.isPriority);
  const otherPersonas = personas.filter(p => !p.isPriority);
  
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
              <p className="text-sm text-muted-foreground">Aucun persona prioritaire</p>
            ) : (
              priorityPersonas.map((persona, idx) => {
                const originalIndex = personas.findIndex(p => p.name === persona.name);
                return (
                  <div 
                    key={persona.name} 
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border bg-${persona.color}-500/10 border-${persona.color}-500/30`}
                  >
                    <Star className={`h-3 w-3 fill-${persona.color}-500 text-${persona.color}-500`} />
                    <span className="text-sm">{persona.name}</span>
                    <button 
                      onClick={() => handleTogglePriority(originalIndex)}
                      className="text-muted-foreground hover:text-foreground ml-1"
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
            {otherPersonas.map((persona, idx) => {
              const originalIndex = personas.findIndex(p => p.name === persona.name);
              return (
                <div 
                  key={persona.name}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted group"
                >
                  <span className="text-sm">{persona.name}</span>
                  <button 
                    onClick={() => handleTogglePriority(originalIndex)}
                    className="text-muted-foreground hover:text-amber-500 ml-1"
                    title="Rendre prioritaire"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                  <button 
                    onClick={() => handleRemovePersona(originalIndex)}
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Supprimer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            
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
        
        {/* Save button */}
        <Button 
          onClick={handleSave} 
          disabled={updateSetting.isPending}
          className="w-full sm:w-auto"
        >
          <Check className="h-4 w-4 mr-2" />
          Sauvegarder
        </Button>
      </CardContent>
    </Card>
  );
}
