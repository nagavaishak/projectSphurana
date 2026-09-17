/**
 * Shown while runtime config is being fetched from /api/runtime-config.
 * Intentionally minimal — no theme, no auth, no router context yet.
 */
const BOOT_KEYFRAMES =
  '@keyframes borradh-boot-spin { to { transform: rotate(360deg); } }';

export function AppBootSplash() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
      }}
      aria-busy="true"
      aria-label="Loading"
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: '2px solid rgba(255,255,255,0.15)',
          borderTopColor: 'rgba(255,255,255,0.7)',
          borderRadius: '50%',
          animation: 'borradh-boot-spin 0.9s linear infinite',
        }}
      />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: scoped keyframes for splash, no user input */}
      <style dangerouslySetInnerHTML={{ __html: BOOT_KEYFRAMES }} />
    </div>
  );
}
