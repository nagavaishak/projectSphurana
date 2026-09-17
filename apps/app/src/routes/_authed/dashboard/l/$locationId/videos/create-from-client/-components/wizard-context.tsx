import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';

export type WizardStep = 'select-client' | 'review-media' | 'configure';

interface WizardState {
  step: WizardStep;
  faceGroupId: string | null;
  templateId: string;
  variationId: string;
}

interface WizardContextValue extends WizardState {
  setFaceGroupId: (id: string) => void;
  setTemplate: (templateId: string, variationId: string) => void;
  goTo: (step: WizardStep) => void;
  goBack: () => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

const STEP_ORDER: WizardStep[] = ['select-client', 'review-media', 'configure'];

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WizardState>({
    step: 'select-client',
    faceGroupId: null,
    templateId: 'before-after',
    variationId: '',
  });

  const setFaceGroupId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, faceGroupId: id }));
  }, []);

  const setTemplate = useCallback((templateId: string, variationId: string) => {
    setState((prev) => ({ ...prev, templateId, variationId }));
  }, []);

  const goTo = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      const idx = STEP_ORDER.indexOf(prev.step);
      if (idx <= 0) return prev;
      return { ...prev, step: STEP_ORDER[idx - 1] };
    });
  }, []);

  return (
    <WizardContext.Provider
      value={{ ...state, setFaceGroupId, setTemplate, goTo, goBack }}
    >
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}
