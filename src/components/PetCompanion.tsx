import { Component, Suspense, useState, useEffect, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Float, useGLTF, OrbitControls } from '@react-three/drei';

const FACTS = [
  "Woof! Satellites track fires from space.",
  "I'm Laika — your fire-detection companion.",
  "VIIRS spots hotspots down to 375 m pixels.",
  "The 2012 MODIS-to-VIIRS step is real.",
  "MODIS bridges to VIIRS via biome transfer.",
  "Freshness matters: the live window is 7 days.",
  "FRP measures fire radiative power in MW.",
  "Every point is flagged: archive, live, or reconstructed.",
];

interface PetCompanionProps {
  size?: number;
}

function PetModel({ onClick }: { onClick: () => void }) {
  const { scene } = useGLTF(`${import.meta.env.BASE_URL || './'}models/pet1.glb`, false);
  return <primitive object={scene} onClick={onClick} />;
}

class PetSceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <div style={{ fontSize: 64, textAlign: 'center' }}>🐶</div> : this.props.children;
  }
}

export function PetCompanion({ size = 150 }: PetCompanionProps) {
  const [talking, setTalking] = useState(false);
  const [fact, setFact] = useState('');

  useEffect(() => {
    if (!talking) return;
    const timer = setTimeout(() => {
      setTalking(false);
      setFact('');
    }, 5000);
    return () => clearTimeout(timer);
  }, [talking, fact]);

  const handleClick = () => {
    const f = FACTS[Math.floor(Math.random() * FACTS.length)];
    setFact(f);
    setTalking(true);
  };

  return (
    <aside
      className="pet-companion"
      aria-label="Laika companion"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: `min(${size}px, calc(100vw - 48px))`,
        zIndex: 40,
        pointerEvents: 'auto',
        borderRadius: 12,
        overflow: 'visible',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        background: 'rgba(10, 12, 16, 0.6)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div role="img" aria-label="3D model of Laika the space dog" style={{ height: size, overflow: 'hidden', borderRadius: 12 }}>
        <PetSceneBoundary>
          <Canvas
            dpr={[1, 1.5]}
            camera={{ position: [0, 0, 3], fov: 40 }}
            fallback={<div style={{ fontSize: 64, textAlign: 'center' }}>🐶</div>}
            style={{ width: '100%', height: '100%', display: 'block', background: 'transparent' }}
          >
            <ambientLight intensity={0.8} />
            <directionalLight position={[2, 4, 3]} intensity={1.5} />
            <OrbitControls makeDefault enablePan={false} enableZoom={false} />
            <Suspense fallback={null}>
              <Bounds fit clip observe margin={1.2} maxDuration={0}>
                <Float speed={1.2} rotationIntensity={0.05} floatIntensity={0.08}>
                  <PetModel onClick={handleClick} />
                </Float>
              </Bounds>
            </Suspense>
          </Canvas>
        </PetSceneBoundary>
      </div>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Ask Laika for a fire science fact"
        style={{ width: '100%', minHeight: 36, border: 0, background: 'transparent', color: 'var(--text, #f4f4f6)', cursor: 'pointer' }}
      >
        Chat with Laika
      </button>
      <a
        href="https://sketchfab.com/3d-models/laika-the-explorer-33dbae0c33a44422bccf753710c3910b"
        target="_blank"
        rel="noopener noreferrer"
        title="Laika the Explorer by beagleknight · CC BY 4.0"
        style={{ display: 'block', padding: '0 6px 8px', textAlign: 'center', fontSize: 10, color: 'var(--muted, #9fa2a8)' }}
      >
        Model: beagleknight
      </a>
      {talking && (
        <div
          role="status"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 12px)',
            right: 0,
            width: 'min(260px, calc(100vw - 48px))',
            boxSizing: 'border-box',
            padding: '6px 10px',
            borderRadius: 8,
            background: '#ff8a3d',
            color: '#0b0c0e',
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 600,
            whiteSpace: 'normal',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.4)',
          }}
        >
          {fact}
        </div>
      )}
    </aside>
  );
}
