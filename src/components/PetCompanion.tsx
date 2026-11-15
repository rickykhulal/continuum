import { Component, Suspense, useState, useEffect, useRef, useMemo, type ReactNode, type RefObject, type PointerEvent } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Bounds } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';
import * as THREE from 'three';
import { useStore } from '../lib/store';

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

function PetModel({ reduceMotion, tether }: { reduceMotion: boolean; tether: RefObject<SVGSVGElement> }) {
  // This uncompressed GLB needs no WASM decoder, which keeps the strict script CSP.
  const { scene } = useLoader(GLTFLoader, `${import.meta.env.BASE_URL || './'}models/pet1.glb`);
  const floating = useRef<Group>(null);
  const waist = useMemo(() => new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3()), [scene]);
  const projected = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock, camera, gl }) => {
    if (floating.current) floating.current.position.y = reduceMotion ? 0 : Math.sin(clock.elapsedTime) * 0.2;
    if (!floating.current || !tether.current) return;
    floating.current.updateWorldMatrix(true, false);
    projected.copy(waist);
    floating.current.localToWorld(projected).project(camera);
    const canvasBox = gl.domElement.getBoundingClientRect();
    const pipeBox = tether.current.getBoundingClientRect();
    if (!pipeBox.width || !pipeBox.height) return;
    const x = canvasBox.left + (projected.x + 1) * canvasBox.width / 2 - pipeBox.left;
    const y = canvasBox.top + (1 - projected.y) * canvasBox.height / 2 - pipeBox.top;
    const curve = `M ${pipeBox.width} ${pipeBox.height} C ${pipeBox.width - 80} ${pipeBox.height - 8}, ${x + 80} ${y + 100}, ${x} ${y}`;
    tether.current.querySelectorAll('path').forEach(path => path.setAttribute('d', curve));
    const socket = tether.current.querySelector('circle');
    socket?.setAttribute('cx', String(x));
    socket?.setAttribute('cy', String(y));
  });
  return <group ref={floating}><primitive object={scene} /></group>;
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
  const { settings } = useStore();
  const [talking, setTalking] = useState(false);
  const [fact, setFact] = useState('');
  const tether = useRef<SVGSVGElement>(null);
  const width = () => Math.min(size, Math.max(0, window.innerWidth - 40));
  const clamp = (left: number, top: number) => ({
    left: Math.max(0, Math.min(left, window.innerWidth - width())),
    top: Math.max(0, Math.min(top, window.innerHeight - size)),
  });
  const [position, setPosition] = useState(() => clamp(window.innerWidth - width() - 20, window.innerHeight - size - 20));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    const resize = () => setPosition(p => clamp(p.left, p.top));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [size]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, ...position, moved: false };
    setDragging(true);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start.moved ||= Math.hypot(dx, dy) > 5;
    if (start.moved) setPosition(clamp(start.left + dx, start.top + dy));
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && !start.moved) handleClick();
  };

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
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        ref={tether}
        className="pet-oxygen-pipe"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
      >
        <path d="M 200 240 C 138 232, 198 150, 105 70" fill="none" stroke="#19bdca" strokeWidth="6" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 5px #29e0ee)' }} />
        <path d="M 200 240 C 138 232, 198 150, 105 70" fill="none" stroke="#bdffff" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="105" cy="70" r="4" fill="#baffff" />
      </svg>
      <div
        className="pet-drag-handle"
        role="button"
        tabIndex={0}
        aria-label="Laika: drag to move; arrow keys move; Enter asks for a fire science fact"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleClick(); }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            setPosition(p => clamp(p.left + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0), p.top + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0)));
          }
        }}
        style={{ position: 'absolute', ...position, width: `min(${size}px, calc(100vw - 40px))`, height: size, pointerEvents: 'auto', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <PetSceneBoundary>
          <Canvas
            dpr={[1, 1.5]}
            camera={{ position: [0, 0, 3], fov: 40 }}
            gl={{ alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
            fallback={<div style={{ fontSize: 64, textAlign: 'center' }}>🐶</div>}
            style={{ width: '100%', height: '100%', display: 'block', background: 'transparent' }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 10]} intensity={1.5} />
            <Suspense fallback={null}>
              <Bounds fit clip observe margin={1.4} maxDuration={0}>
                <PetModel reduceMotion={settings.reduceMotion} tether={tether} />
              </Bounds>
            </Suspense>
          </Canvas>
        </PetSceneBoundary>
      {talking && (
        <div
          role="status"
          style={{
            position: 'absolute',
            bottom: position.top < 110 ? undefined : 'calc(100% + 12px)',
            top: position.top < 110 ? 'calc(100% + 12px)' : undefined,
            left: position.left < 110 ? 0 : undefined,
            right: position.left < 110 ? undefined : 0,
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
      </div>
    </aside>
  );
}
