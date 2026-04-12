export default function RippleField({ visible }) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-[3] flex items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border"
          style={{
            width: `${180 + i * 120}px`,
            height: `${180 + i * 120}px`,
            borderColor: `rgba(0, 255, 153, ${0.35 - i * 0.07})`,
            left: '50%',
            top: '50%',
            animation: `rippleRing ${2.5 + i * 0.6}s ease-out infinite`,
            animationDelay: `${i * 0.5}s`,
          }}
        />
      ))}
    </div>
  );
}
