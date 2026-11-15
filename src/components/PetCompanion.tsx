import { useState, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      float: any;
    }
  }
}

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

export function PetCompanion({ size = 150 }: PetCompanionProps) {
  const [talking, setTalking] = useState(false);
  const [fact, setFact] = useState('');
  const groupRef = useRef<THREE.Group>(null);
  const { size: viewport } = useThree();

  useEffect(() => {
    if (!talking) return;
    const timer = setTimeout(() => {
      setTalking(false);
      setFact('');
    }, 5000);
    return () => clearTimeout(timer);
  }, [talking]);

  const handleClick = () => {
    const f = FACTS[Math.floor(Math.random() * FACTS.length)];
    setFact(f);
    setTalking(true);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: size,
        height: size,
        zIndex: 40,
        pointerEvents: 'auto',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        background: 'rgba(10, 12, 16, 0.6)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <Canvas
        shadows
        camera={{ position: [0, 0, 3], fov: 40 }}
        style={{ width: '100%', height: '100%', display: 'block', background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 4, 3]} intensity={1.2} castShadow />
        <OrbitControls makeDefault />
        <float speed={1.2} rotationIntensity={0.05} floatIntensity={0.08}>
          <primitive
            object={useGLTF(`${import.meta.env.BASE_URL || './'}models/pet1.glb`) as unknown as THREE.Object3D}
            ref={groupRef}
            onClick={handleClick}
            pointerEvents
            scale={0.5}
            rotation={[-Math.PI / 2, 0, 0]}
          />
          <spotLight position={[0, 5, 5]} angle={0.3} penumbra={0.5} intensity={1} castShadow />
          {talking && (
            <mesh
              position={[0, 1.4, 0]}
              onClick={(e) => { e.stopPropagation(); }}
            >
              <sphereGeometry args={[0.5, 16, 16]} />
              <meshBasicMaterial color="#ff8a3d" transparent opacity={0.95} />
            </mesh>
          )}
        </float>
      </Canvas>
      {talking && (
        <div
          style={{
            position: 'absolute',
            top: -34,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 10px',
            borderRadius: 8,
            background: '#ff8a3d',
            color: '#0b0c0e',
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.4)',
          }}
        >
          {fact}
        </div>
      )}
    </div>
  );
}
