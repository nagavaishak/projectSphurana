'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WhatsappPairingCard } from '@/features/assistant';
import { MessageCircle } from 'lucide-react';

export function ClaireTab() {
  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="text-lg font-semibold">Claire Settings</h2>
        <p className="text-muted-foreground text-sm">
          Configure how Claire interacts with your team and customers.
        </p>
      </div>

      <Tabs defaultValue="whatsapp" className="w-full">
        <TabsList className="grid w-full grid-cols-1">
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageCircle className="size-4" />
            WhatsApp
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsappPairingCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
