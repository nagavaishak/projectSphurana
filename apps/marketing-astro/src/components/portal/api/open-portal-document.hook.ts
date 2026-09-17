'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { patientFetch } from '@/lib/patient-fetch';

import { usePortal } from './portal-provider';
import type { DocumentDownloadUrlResponse } from './types';

/**
 * Open a vault document via a short-lived presigned URL.
 *
 * The stored object lives in a PRIVATE bucket and is not directly fetchable —
 * every open goes through the download endpoint, which re-verifies ownership
 * server-side and mints a 5-minute URL.
 *
 * The tab must be opened SYNCHRONOUSLY in the click handler (popup blockers
 * kill window.open after an await), so we open a blank tab first and navigate
 * it once the URL arrives.
 */
export const useOpenPortalDocument = () => {
  const { organizationSlug } = usePortal();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openDocument = async (documentId: string) => {
    setOpeningId(documentId);
    const tab = window.open('about:blank', '_blank');
    // Sever the opener link: that tab navigates to an object whose bytes are
    // user-uploaded. Without this it could reach back through `window.opener`
    // and redirect THIS tab to a phishing page (reverse tabnabbing).
    if (tab) tab.opener = null;
    try {
      const { url } = await patientFetch<DocumentDownloadUrlResponse>(
        `${'patient/documents'}/${documentId}/download`,
        { organizationSlug }
      );
      if (tab) {
        tab.location.href = url;
      } else {
        // Popup blocked — same-tab navigation as a fallback.
        window.location.href = url;
      }
    } catch {
      tab?.close();
      toast.error('Could not open the document — please try again');
    } finally {
      setOpeningId(null);
    }
  };

  return { openDocument, openingId };
};
