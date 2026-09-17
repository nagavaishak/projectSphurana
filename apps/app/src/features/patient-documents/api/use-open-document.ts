import { apiClient } from '@borradh-workspace/api-client';
import { useState } from 'react';
import { toast } from 'sonner';

interface DownloadUrlResponse {
  url: string;
  expiresIn: number;
  fileName: string;
  mimeType: string;
}

/**
 * Open a vault document via a short-lived presigned URL (ENG-647).
 *
 * The stored blobUrl points at the PRIVATE bucket and is not directly
 * fetchable — every open goes through the download endpoint, which
 * re-verifies ownership server-side and mints a 5-minute URL.
 *
 * The tab must be opened synchronously in the click handler (popup blockers
 * kill window.open after an await), so we open a blank tab first and
 * navigate it once the URL arrives.
 */
function useOpenDocument(
  fetchUrl: (documentId: string) => Promise<DownloadUrlResponse>
) {
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openDocument = async (documentId: string) => {
    setOpeningId(documentId);
    const tab = window.open('about:blank', '_blank');
    // Sever the opener link: the tab will navigate to an S3-hosted object whose
    // bytes are user-uploaded. Without this, that page could reach back through
    // `window.opener` and redirect THIS app tab (reverse tabnabbing) to a
    // phishing page. The download presign also forces `Content-Disposition:
    // attachment`, so this is defense-in-depth on top of that.
    if (tab) tab.opener = null;
    try {
      const { url } = await fetchUrl(documentId);
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
}

/** Dashboard (staff session) variant. */
export function useOpenStaffPatientDocument(leadId: string) {
  return useOpenDocument((documentId) =>
    apiClient.get<DownloadUrlResponse>(
      `leads/${leadId}/documents/${documentId}/download`
    )
  );
}
