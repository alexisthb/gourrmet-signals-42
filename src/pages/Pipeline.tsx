import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Radio, Users, TrendingUp, Calendar } from 'lucide-react';
import { useIntervenedSignals } from '@/hooks/useSignalInteractions';
import { useIntervenedContacts } from '@/hooks/useContactInteractions';
import { PipelineSignalsTab } from '@/components/pipeline/PipelineSignalsTab';
import { PipelineContactsTab } from '@/components/pipeline/PipelineContactsTab';
import { StatCard } from '@/components/StatCard';

export default function Pipeline() {
  const [activeTab, setActiveTab] = useState('signals');
  
  const { data: intervenedSignalIds = [] } = useIntervenedSignals();
  const { data: intervenedContactIds = [] } = useIntervenedContacts();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">
          Pipeline
        </h1>
        <p className="text-muted-foreground mt-1">
          Vos signaux et contacts en cours de traitement
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label="Signaux actifs"
          value={intervenedSignalIds.length}
          icon={Radio}
          variant="coral"
        />
        <StatCard
          label="Contacts en cours"
          value={intervenedContactIds.length}
          icon={Users}
          variant="turquoise"
        />
        <StatCard
          label="Actions à faire"
          value={0}
          icon={Calendar}
          variant="yellow"
        />
        <StatCard
          label="Taux de conversion"
          value="--"
          icon={TrendingUp}
          variant="coral"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="signals" className="gap-2">
            <Radio className="h-4 w-4" />
            Signaux
            <Badge variant="secondary" className="ml-1">
              {intervenedSignalIds.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="contacts" className="gap-2">
            <Users className="h-4 w-4" />
            Contacts
            <Badge variant="secondary" className="ml-1">
              {intervenedContactIds.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signals">
          <PipelineSignalsTab signalIds={intervenedSignalIds} />
        </TabsContent>

        <TabsContent value="contacts">
          <PipelineContactsTab contactIds={intervenedContactIds} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
