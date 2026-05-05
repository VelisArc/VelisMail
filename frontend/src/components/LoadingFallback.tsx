/**
 * LoadingFallback — Premium center-screen loading with blur backdrop.
 * No background color, uses full-screen blur overlay.
 */
export default function LoadingFallback() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      background: 'rgba(0, 0, 0, 0.6)',
    }} role="status" aria-label="Loading">
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
      }}>
        {/* Animated dots */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#ededed',
              animation: `loadPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
        <span style={{ color: '#a1a1aa', fontSize: '0.85rem', fontWeight: 500, letterSpacing: '0.05em' }}>
          Loading
        </span>
        <style>{`
          @keyframes loadPulse {
            0%, 80%, 100% { transform: scale(0.4); opacity: 0.3; }
            40% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}
