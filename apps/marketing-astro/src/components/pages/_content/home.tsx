import { ClaireHub } from '@/components/marketing/claire-hub';
import { DailySummary } from '@/components/marketing/daily-summary';
import { FAQs } from '@/components/marketing/faqs';
import { Hero } from '@/components/marketing/hero';
import { HowItWorksSteps } from '@/components/marketing/how-it-works-steps';
import { LiveActivity } from '@/components/marketing/live-activity';
import { LogoCloud } from '@/components/marketing/logo-cloud';
import { MidnightLead } from '@/components/marketing/midnight-lead';
import { Pricing } from '@/components/marketing/pricing';
import { Results } from '@/components/marketing/results';

export const metadata = {
  title: 'Borradh — Claire AI runs your entire clinic',
  description:
    'Claire is your clinic’s AI employee. She finds new patients, books them in, collects deposits, and keeps them coming back. You do treatments. Claire does everything else.',
};

export default function Home() {
  return (
    <div className="min-h-screen">
      <Hero />
      <div className="relative z-10 bg-background">
        <LogoCloud />
        <MidnightLead />
        <DailySummary />
        <ClaireHub />
        <LiveActivity />
        <Results />
        <HowItWorksSteps />
        <Pricing />
        <FAQs />
      </div>
    </div>
  );
}
