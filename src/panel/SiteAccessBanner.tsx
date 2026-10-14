import { Globe } from 'lucide-react';
import { useSiteAccess } from '@/hooks/useSettings';

export function SiteAccessBanner() {
  const { granted, request } = useSiteAccess();
  if (granted !== false) return null;
  return (
    <div className="banner" role="note">
      <Globe size={16} />
      <strong>Allow website access</strong>
      <p style={{ gridColumn: 2 }}>
        LatentNest needs permission to download images from the sites you browse. Without it, many images can’t be saved, including ones a site covers with an overlay, like Instagram’s.
      </p>
      <button className="btn btn-primary btn-sm" onClick={() => void request()}>
        Allow access
      </button>
    </div>
  );
}
