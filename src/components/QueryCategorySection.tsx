import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Trash2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import type { SearchQuery, SignalType } from '@/types/database';
import { cn } from '@/lib/utils';

interface CategoryConfig {
  id: SignalType;
  label: string;
  emoji: string;
  color: string;
}

export const CATEGORY_CONFIG: CategoryConfig[] = [
  { id: 'anniversaire', label: 'Anniversaires', emoji: '🎂', color: 'bg-violet-500/10 border-violet-500/30 text-violet-600' },
  { id: 'levee', label: 'Levées de fonds', emoji: '💰', color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' },
  { id: 'ma', label: 'Fusions & Acquisitions', emoji: '🤝', color: 'bg-blue-500/10 border-blue-500/30 text-blue-600' },
  { id: 'distinction', label: 'Distinctions', emoji: '🏆', color: 'bg-amber-500/10 border-amber-500/30 text-amber-600' },
  { id: 'expansion', label: 'Expansion', emoji: '🏢', color: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-600' },
  { id: 'nomination', label: 'Nominations', emoji: '👔', color: 'bg-slate-500/10 border-slate-500/30 text-slate-600' },
];

interface QueryCategorySectionProps {
  category: CategoryConfig;
  queries: SearchQuery[];
  onToggle: (id: string, is_active: boolean) => void;
  onDelete: (id: string) => void;
}

export function QueryCategorySection({ category, queries, onToggle, onDelete }: QueryCategorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const activeCount = queries.filter(q => q.is_active).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center justify-between p-4 transition-colors",
          category.color,
          "hover:opacity-90"
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{category.emoji}</span>
          <span className="font-semibold">{category.label}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-background/50 font-medium">
            {activeCount}/{queries.length} actives
          </span>
        </div>
        {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
      </button>
      
      {isExpanded && (
        <div className="divide-y divide-border bg-background">
          {queries.map((query) => (
            <div
              key={query.id}
              className="flex items-center gap-4 p-4"
            >
              <Switch
                checked={query.is_active}
                onCheckedChange={(checked) => onToggle(query.id, checked)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground truncate">{query.name}</p>
                  {query.description && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>{query.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {query.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{query.description}</p>
                )}
                <p className="text-xs text-muted-foreground/70 truncate mt-1 font-mono">{query.query}</p>
                {query.last_fetched_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Dernier fetch: {formatDistanceToNow(new Date(query.last_fetched_at), { addSuffix: true, locale: fr })}
                  </p>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer la requête ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action est irréversible. La requête "{query.name}" sera définitivement supprimée.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDelete(query.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
          {queries.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground text-center">
              Aucune requête dans cette catégorie
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface QueryCoverageProps {
  queries: SearchQuery[];
}

export function QueryCoverage({ queries }: QueryCoverageProps) {
  const getCategoryCount = (categoryId: SignalType) => 
    queries.filter(q => q.category === categoryId && q.is_active).length;

  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_CONFIG.map((cat) => (
        <div
          key={cat.id}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border",
            cat.color
          )}
        >
          <span>{cat.emoji}</span>
          <span className="font-medium">{getCategoryCount(cat.id)}</span>
        </div>
      ))}
    </div>
  );
}
