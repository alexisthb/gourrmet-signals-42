import { toast } from 'sonner';

/**
 * Handler standard à passer en `onError` des mutations React Query "side
 * effect" (logging d'interaction, save feedback, etc.) qui, sans handler,
 * échouaient SILENCIEUSEMENT (l'utilisateur voyait un toast de succès du
 * flux principal alors que la persistance secondaire avait échoué).
 *
 * Affiche un toast d'avertissement compact + log la stack pour debug.
 *
 * Usage:
 *   createInteraction.mutate(payload, { onError: onMutationError('Interaction non enregistrée') })
 */
export function onMutationError(label: string) {
  return (error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[mutation] ${label}:`, error);
    toast.error(label, { description: msg });
  };
}
