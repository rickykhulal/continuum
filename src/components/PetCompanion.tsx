import { Component, Suspense, useState, useEffect, useRef, useMemo, useCallback, type ReactNode, type RefObject, type PointerEvent } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Bounds } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';
import * as THREE from 'three';
import { useStore } from '../lib/store';

const FACTS = [
  'Did you know? MODIS active-fire pixels are about 1 km.',
  'VIIRS active-fire pixels are 375 m.',
  'FRP is fire radiative power, measured in megawatts.',
  'Continuum labels archive observations, the live window, and calibrated reconstruction separately.',
  'Open-Meteo supplies current wind forecasts; NASA POWER supplies historical reanalysis.',
  'Woof! A hotspot detection is not the same as a separate fire.',
  'MODIS and VIIRS use different sensors, so comparisons need calibration.',
  'Freshness matters: Continuum labels its seven-day observed window.',
];

const FACT_INTERVAL_MS = 45_000;
const FACT_DURATION_MS = 10_000;

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
  const lastFactIndex = useRef(-1);
  const hideFactTimer = useRef<number | null>(null);
  const tether = useRef<SVGSVGElement>(null);
  const width = () => Math.min(size, Math.max(0, window.innerWidth - 40));
  const clamp = (left: number, top: number) => ({
    left: Math.max(0, Math.min(left, window.innerWidth - width())),
    top: Math.max(0, Math.min(top, window.innerHeight - size)),
  });
  const anchor = () => clamp(window.innerWidth - width() - 20, window.innerHeight - size - (window.innerWidth <= 700 ? 170 : 120));
  const [position, setPosition] = useState(anchor);
  const userMoved = useRef(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useEffect(() => {
    const resize = () => setPosition(p => userMoved.current ? clamp(p.left, p.top) : anchor());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [size]);

  const showFact = useCallback(() => {
    // Pick from the remaining facts so consecutive visits never repeat one.
    let index = Math.floor(Math.random() * (FACTS.length - (lastFactIndex.current < 0 ? 0 : 1)));
    if (lastFactIndex.current >= 0 && index >= lastFactIndex.current) index++;
    lastFactIndex.current = index;
    if (hideFactTimer.current !== null) window.clearTimeout(hideFactTimer.current);
    setFact(FACTS[index]);
    setTalking(true);
    hideFactTimer.current = window.setTimeout(() => {
      setTalking(false);
      setFact('');
      hideFactTimer.current = null;
    }, FACT_DURATION_MS);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(showFact, FACT_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (hideFactTimer.current !== null) {
        window.clearTimeout(hideFactTimer.current);
        hideFactTimer.current = null;
      }
    };
  }, [showFact]);

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
    if (start.moved) {
      userMoved.current = true;
      setPosition(clamp(start.left + dx, start.top + dy));
    }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup' && !start.moved) showFact();
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
        aria-label="Laika shares a fire science fact every 45 seconds; drag or use arrow keys to move; Enter asks for another fact"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showFact(); }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            userMoved.current = true;
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
          className="pet-speech-bubble"
          role="status"
          style={{
            position: 'absolute',
            bottom: position.top < 110 ? undefined : 'calc(100% + 12px)',
            top: position.top < 110 ? 'calc(100% + 12px)' : undefined,
            left: position.left < 110 ? 0 : undefined,
            right: position.left < 110 ? undefined : 0,
          }}
        >
          {fact}
        </div>
      )}
      </div>
    </aside>
  );
}
