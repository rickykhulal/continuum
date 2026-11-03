import { useEffect, useImperativeHandle, useRef, forwardRef, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { REGIONS } from '../lib/data';
import { loadSatellites, type OrbitSatellite } from '../lib/satellites';
import { propagateAt, groundTrack, swathPolygon, swathCovers } from '../lib/sgp4';
import { subsolarPoint, latLonToVec3, vec3ToLatLon, normalizeLon, decodeLand, fittedMapBounds, type Topology } from '../lib/geo';
import { whereAt, countryWindow, windowMeta_ } from '../lib/countries';
import { SENSOR_COLORS, type Region } from '../lib/types';
import { gibsBasemapUrl } from '../lib/basemap';
import { useStore } from '../lib/store';

export interface GlobeHandle {
  resetLive: () => void;
  focusRegion: (center?: [number, number]) => void;
  focusSatellite: (id: string) => void;
  seek: (ms: number) => void;
}

interface Props {
  playing: boolean;
  speed: number;
  selectedSat: string | null;
  onSelectSat: (id: string | null) => void;
  onTick: (ms: number) => void;
  onToast: (msg: string) => void;
  onSatStats: (stats: { id: string; lat: number; lon: number; alt: number; covered: boolean }[]) => void;
}

const RADIUS = 1;
const EARTH_R = 6371;
const BASE = import.meta.env.BASE_URL || './';

function markerTexture(hex: string): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, hex);
  grad.addColorStop(0.5, hex + '88');
  grad.addColorStop(1, hex + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fallbackDay(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0b2033');
  grad.addColorStop(0.5, '#0a2436');
  grad.addColorStop(1, '#071a28');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D dayDetail;
  uniform sampler2D nightDetail;
  uniform vec4 detailRect;
  uniform float detailMix;
  uniform sampler2D viewDay;
  uniform sampler2D viewNight;
  uniform vec4 viewRect;
  uniform float viewMix;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float sun = dot(n, normalize(sunDir));
    float day = smoothstep(-0.10, 0.22, sun);
    float twilight = smoothstep(-0.24, 0.02, sun) * (1.0 - smoothstep(0.02, 0.32, sun));

    // Two NASA GIBS layers sharpen the 8K mosaic as the camera closes in: a viewport crop
    // that follows the camera, then a tighter per-region crop on top of it.
    vec2 wUv = (vUv - viewRect.xy) / viewRect.zw;
    float wInside = step(0.0, wUv.x) * step(wUv.x, 1.0) * step(0.0, wUv.y) * step(wUv.y, 1.0);
    float wEdge = smoothstep(0.0, 0.08, wUv.x) * (1.0 - smoothstep(0.92, 1.0, wUv.x))
                * smoothstep(0.0, 0.08, wUv.y) * (1.0 - smoothstep(0.92, 1.0, wUv.y));
    float wm = viewMix * wInside * wEdge;

    vec2 dUv = (vUv - detailRect.xy) / detailRect.zw;
    float dInside = step(0.0, dUv.x) * step(dUv.x, 1.0) * step(0.0, dUv.y) * step(dUv.y, 1.0);
    float dEdge = smoothstep(0.0, 0.06, dUv.x) * (1.0 - smoothstep(0.94, 1.0, dUv.x))
                * smoothstep(0.0, 0.06, dUv.y) * (1.0 - smoothstep(0.94, 1.0, dUv.y));
    float m = detailMix * dInside * dEdge;

    vec3 albedo = mix(texture2D(dayMap, vUv).rgb, texture2D(viewDay, wUv).rgb, wm);
    vec3 lights = mix(texture2D(nightMap, vUv).rgb, texture2D(viewNight, wUv).rgb, wm);
    albedo = mix(albedo, texture2D(dayDetail, dUv).rgb, m);
    lights = mix(lights, texture2D(nightDetail, dUv).rgb, m);

    // Blue Marble bathymetry paints water deep blue; land is green, tan or grey.
    float water = smoothstep(0.015, 0.085, albedo.b - max(albedo.r, albedo.g) * 0.82)
                * smoothstep(0.02, 0.10, albedo.b);

    vec3 col = albedo * (0.085 + 1.04 * day);
    col += lights * vec3(1.0, 0.70, 0.34) * (1.0 - day) * 1.32;
    col += vec3(1.0, 0.34, 0.08) * twilight * 0.15;

    vec3 halfDir = normalize(normalize(sunDir) + viewDir);
    float glint = pow(max(dot(n, halfDir), 0.0), 72.0) * day * water;
    col += vec3(1.0, 0.93, 0.80) * glint * 0.62;

    float limb = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
    col += vec3(0.10, 0.30, 0.62) * limb * (0.16 + 0.9 * day) * 0.42;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMO_FRAG = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 tint;
  uniform float intensity;
  uniform float falloff;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), falloff);
    float sun = smoothstep(-0.62, 0.42, dot(n, normalize(sunDir)));
    float a = rim * intensity * (0.22 + 0.86 * sun);
    gl_FragColor = vec4(tint * a, a);
  }
`;

function atmosphereShell(radius: number, tint: THREE.Color, intensity: number, falloff: number) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      tint: { value: tint },
      intensity: { value: intensity },
      falloff: { value: falloff },
    },
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat);
  mesh.renderOrder = 1;
  return { mesh, mat };
}

export const Globe = memo(forwardRef<GlobeHandle, Props>(function Globe(
  { playing, speed, selectedSat, onSelectSat, onTick, onToast, onSatStats },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const selectedRef = useRef(selectedSat);
  const onSatStatsRef = useRef(onSatStats);
  playingRef.current = playing;
  speedRef.current = speed;
  selectedRef.current = selectedSat;
  onSatStatsRef.current = onSatStats;

  const apiRef = useRef<{ focusLatLon: (lat: number, lon: number, dist?: number) => void; reset: () => void; setSelected: (id: string | null) => void; seek: (ms: number) => void } | null>(null);
  const fireRebuildRef = useRef<(() => void) | null>(null);
  const detailRequestRef = useRef<((region: Region) => void) | null>(null);

  useEffect(() => {
    fireRebuildRef.current?.();
  }, [store.live]);

  useEffect(() => {
    detailRequestRef.current?.(store.region);
  }, [store.region]);

  useImperativeHandle(ref, () => ({
    resetLive: () => apiRef.current?.reset(),
    focusRegion: (center) => {
      const r = storeRef.current.region;
      const [lat, lon] = center ?? r.center;
      apiRef.current?.focusLatLon(lat, lon, 2.3);
    },
    focusSatellite: (id: string) => apiRef.current?.setSelected(id),
    seek: (ms: number) => apiRef.current?.seek(ms),
  }), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mountEl: HTMLDivElement = mount;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, mount.clientWidth / Math.max(1, mount.clientHeight), 0.01, 240);
    camera.position.set(1.45, 0.92, 2.62);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D Earth with live satellite orbits');
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.7;
    controls.minDistance = 1.09;
    controls.maxDistance = 6.5;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;

    // --- stars ------------------------------------------------------------
    const buildStars = (count: number, inner: number, outer: number, size: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      const pos: number[] = [];
      const col: number[] = [];
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        const u = Math.random() * 2 - 1;
        const t = Math.random() * Math.PI * 2;
        const r = inner + Math.random() * (outer - inner);
        const s = Math.sqrt(1 - u * u);
        pos.push(r * s * Math.cos(t), r * u, r * s * Math.sin(t));
        const k = Math.random();
        c.setHSL(k < 0.72 ? 0.58 : k < 0.9 ? 0.09 : 0.0, k < 0.72 ? 0.35 : 0.25, 0.72 + Math.random() * 0.24);
        col.push(c.r, c.g, c.b);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({
        size, vertexColors: true, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
      }));
      scene.add(points);
      return points;
    };
    const starsFar = buildStars(2600, 32, 70, 0.055, 0.62);
    const starsNear = buildStars(500, 16, 30, 0.028, 0.42);

    // --- textures ---------------------------------------------------------
    const maxTex = renderer.capabilities.maxTextureSize;
    const dayUrl = maxTex >= 8192 ? `${BASE}textures/earth_day_8k.jpg` : `${BASE}textures/earth_day_4k.jpg`;
    const nightUrl = maxTex >= 8192 ? `${BASE}textures/earth_night_8k.jpg` : `${BASE}textures/earth_night_4k.jpg`;
    const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const blank = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const configure = (tex: THREE.Texture) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    };
    const loader = new THREE.TextureLoader();
    const dayTex = loader.load(dayUrl, configure, undefined, () => {
      earthMat.uniforms.dayMap.value = fallbackDay();
    });
    configure(dayTex);
    const nightTex = loader.load(nightUrl, configure, undefined, () => undefined);
    configure(nightTex);

    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: dayTex },
        nightMap: { value: nightTex },
        dayDetail: { value: blank },
        nightDetail: { value: blank },
        detailRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        detailMix: { value: 0 },
        viewDay: { value: blank },
        viewNight: { value: blank },
        viewRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        viewMix: { value: 0 },
        sunDir: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 160, 96), earthMat);
    earth.userData.pick = 'earth';
    scene.add(earth);

    // --- atmosphere -------------------------------------------------------
    // Two thin Fresnel shells: the Earth's disc occludes their centres, so only
    // the limb survives and the glow is a true scattering rim, not a flat sprite.
    const atmoInner = atmosphereShell(1.008, new THREE.Color(0.34, 0.66, 1.0), 0.84, 3.1);
    const atmoOuter = atmosphereShell(1.058, new THREE.Color(0.18, 0.44, 0.96), 0.64, 1.85);
    scene.add(atmoInner.mesh);
    scene.add(atmoOuter.mesh);

    // --- country outlines -------------------------------------------------
    fetch(`${BASE}data/countries-50m.json`)
      .then((r) => r.json() as Promise<Topology>)
      .then((topo) => {
        const rings = decodeLand(topo, 'countries');
        const pts: number[] = [];
        for (const poly of rings) {
          for (const ring of poly) {
            for (let i = 1; i < ring.length; i++) {
              const [lon1, lat1] = ring[i - 1];
              const [lon2, lat2] = ring[i];
              if (Math.abs(lon2 - lon1) > 180) continue;
              const a = latLonToVec3(lat1, lon1, RADIUS * 1.0016);
              const b = latLonToVec3(lat2, lon2, RADIUS * 1.0016);
              pts.push(...a, ...b);
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const land = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffe6c4, transparent: true, opacity: 0.14, depthWrite: false }));
        scene.add(land);
      })
      .catch(() => undefined);

    // --- live fires -------------------------------------------------------
    const glow = markerTexture('#ff8a3d');
    const firesGroup = new THREE.Group();
    const pointMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glow }, opacity: { value: 0.95 } },
      vertexShader: `
        attribute vec3 iPos;
        attribute vec3 iColor;
        attribute float iSize;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          vColor = iColor;
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          // Keep detections visually constant instead of ballooning into blobs on close zoom.
          float depth = max(0.05, -mv.z);
          float scale = clamp(depth / 2.2, 0.07, 1.0);
          mv.xy += position.xy * iSize * scale;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float opacity;
        varying vec3 vColor;
        varying vec2 vUv;
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.02) discard;
          vec3 col = mix(vColor, vec3(1.0), pow(t.a, 5.0) * 0.6);
          gl_FragColor = vec4(col, t.a * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    const firePoints = new THREE.Mesh(new THREE.InstancedBufferGeometry(), pointMat);
    firePoints.renderOrder = 3;
    firePoints.frustumCulled = false;
    firesGroup.add(firePoints);
    scene.add(firesGroup);

    const rebuildFires = () => {
      const live = storeRef.current.live;
      const firePos: number[] = [];
      const fireCol: number[] = [];
      const fireSize: number[] = [];
      const c = new THREE.Color();
      if (live) {
        for (const f of live.fires) {
          const [lat, lon, frp, sensor] = f;
          const v = latLonToVec3(lat, lon, RADIUS * 1.007);
          firePos.push(v[0], v[1], v[2]);
          c.set(SENSOR_COLORS[sensor] ?? '#ff8a3d');
          fireCol.push(c.r, c.g, c.b);
          fireSize.push(0.0055 + Math.min(0.008, Math.max(0, frp) / 24000));
        }
      }
      const geo = new THREE.InstancedBufferGeometry();
      const base = new THREE.PlaneGeometry(1, 1);
      geo.index = base.index;
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('uv', base.getAttribute('uv'));
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(firePos), 3));
      geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(fireCol), 3));
      geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(fireSize), 1));
      geo.instanceCount = fireSize.length;
      firePoints.geometry.dispose();
      firePoints.geometry = geo;
    };
    fireRebuildRef.current = rebuildFires;
    rebuildFires();

    // --- pilot region markers --------------------------------------------
    const markers = new THREE.Group();
    const markerRings: THREE.Mesh[] = [];
    const markerDots: THREE.Mesh[] = [];
    const markerHitMeshes: THREE.Mesh[] = [];
    for (const r of REGIONS) {
      const pos = latLonToVec3(r.center[0], r.center[1], RADIUS * 1.004);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.011, 0.016, 40),
        new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.position.set(...pos);
      ring.lookAt(0, 0, 0);
      ring.userData.pick = 'region';
      ring.userData.regionId = r.id;
      ring.userData.phase = Math.random() * Math.PI * 2;
      markers.add(ring);
      markerRings.push(ring);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.0045, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      dot.position.set(...pos);
      dot.userData.pick = 'region';
      dot.userData.regionId = r.id;
      markers.add(dot);
      markerDots.push(dot);
      // A marker drawn at 0.016 world units is a ~10 px target; this invisible shell gives the
      // click a forgiving radius without changing the rendering.
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.034, 10, 10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.position.set(...pos);
      hit.userData.pick = 'region';
      hit.userData.regionId = r.id;
      markers.add(hit);
      markerHitMeshes.push(hit);
    }
    scene.add(markers);

    // --- satellites -------------------------------------------------------
    let sats: OrbitSatellite[] = [];
    const satGroup = new THREE.Group();
    scene.add(satGroup);
    const orbitGroup = new THREE.Group();
    scene.add(orbitGroup);
    const satObjects = new Map<string, {
      mesh: THREE.Group;
      halo: THREE.Sprite;
      orbit: THREE.Line;
      trail: THREE.Line;
      swath: THREE.Mesh;
      tether: THREE.Line;
      label: HTMLButtonElement;
    }>();
    const labelLayer = document.createElement('div');
    labelLayer.className = 'globe-labels';
    mount.appendChild(labelLayer);
    const regionLabels: { el: HTMLDivElement; lat: number; lon: number }[] = [];

    for (const r of REGIONS) {
      const el = document.createElement('div');
      el.className = 'globe-region-label';
      el.textContent = r.shortName;
      el.style.pointerEvents = 'none';
      labelLayer.appendChild(el);
      regionLabels.push({ el, lat: r.center[0], lon: r.center[1] });
    }

    function buildSatellite(s: OrbitSatellite) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(0.017, 0.013, 0.013),
        new THREE.MeshStandardMaterial({ color: 0xdfe8f2, emissive: new THREE.Color(s.color), emissiveIntensity: 0.35, metalness: 0.75, roughness: 0.3 }),
      );
      group.add(core);
      for (const sign of [-1, 1]) {
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.042, 0.0012, 0.015),
          new THREE.MeshStandardMaterial({ color: 0x0d2237, emissive: new THREE.Color(s.color), emissiveIntensity: 0.45, metalness: 0.9, roughness: 0.35 }),
        );
        panel.position.x = sign * 0.033;
        group.add(panel);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: markerTexture(s.color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
      }));
      halo.scale.set(0.07, 0.07, 1);
      group.add(halo);
      group.userData.pick = 'satellite';
      group.userData.satId = s.id;
      core.userData.pick = 'satellite';
      core.userData.satId = s.id;
      satGroup.add(group);

      const orbit = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.16, depthWrite: false }),
      );
      orbit.frustumCulled = false;
      orbitGroup.add(orbit);

      const trail = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      trail.frustumCulled = false;
      orbitGroup.add(trail);

      const swath = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
        color: s.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      swath.frustumCulled = false;
      scene.add(swath);

      const tether = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.28, depthWrite: false }),
      );
      tether.frustumCulled = false;
      scene.add(tether);

      const label = document.createElement('button');
      label.className = 'globe-sat-label';
      label.innerHTML = `<span style="background:${s.color}"></span>${s.short}`;
      label.style.borderColor = `${s.color}55`;
      label.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onSelectSat(s.id);
        apiRef.current?.setSelected(s.id);
      });
      labelLayer.appendChild(label);

      satObjects.set(s.id, { mesh: group, halo, orbit, trail, swath, tether, label });
    }

    loadSatellites().then((list) => {
      sats = list;
      sats.forEach(buildSatellite);
    });

    // --- time -------------------------------------------------------------
    let simMs = Date.now();
    let orbitClock = 0;
    let ringClock = 99;
    const periodMinutes = 102;

    function setLine(line: THREE.Line, positions: number[]) {
      line.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      line.geometry = g;
    }

    function buildRing(s: OrbitSatellite, date: Date) {
      const obj = satObjects.get(s.id);
      if (!obj) return;
      const pts: number[] = [];
      for (let i = 0; i <= 220; i++) {
        const t = new Date(date.getTime() + (i / 220) * periodMinutes * 60000);
        const p = propagateAt(s, t);
        if (!p) continue;
        pts.push(...latLonToVec3(p.lat, p.lon, RADIUS * (1 + p.altKm / EARTH_R)));
      }
      setLine(obj.orbit, pts);
    }

    function updateOrbit(s: OrbitSatellite, date: Date) {
      const obj = satObjects.get(s.id);
      if (!obj) return;
      const selected = selectedRef.current === s.id;
      const track = groundTrack(s, date, 52, 42);
      const surface = track.map(([lat, lon]) => latLonToVec3(lat, lon, RADIUS * 1.0035));
      setLine(obj.swath.userData.trackLine ?? (obj.swath.userData.trackLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.2, depthWrite: false }))), surface.flat());
      if (!obj.swath.userData.trackLine.parent) scene.add(obj.swath.userData.trackLine);

      const poly = swathPolygon(track, s.swathKm * 0.55);
      const sp: number[] = [];
      for (const [lat, lon] of poly) sp.push(...latLonToVec3(lat, lon, RADIUS * 1.005));
      const idx: number[] = [];
      const n = poly.length;
      if (n >= 4) {
        const half = n / 2;
        for (let i = 0; i < half - 1; i++) {
          const a = i, b = i + 1, c2 = n - 1 - i, d = n - 2 - i;
          idx.push(a, b, c2, b, d, c2);
        }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setIndex(idx);
      obj.swath.geometry.dispose();
      obj.swath.geometry = sg;
      (obj.swath.material as THREE.MeshBasicMaterial).opacity = selected ? 0.16 : 0;
      (obj.orbit.material as THREE.LineBasicMaterial).opacity = selected ? 0.52 : 0.13;
      (obj.trail.material as THREE.LineBasicMaterial).opacity = selected ? 0.8 : 0.22;
      (obj.swath.userData.trackLine.material as THREE.LineBasicMaterial).opacity = selected ? 0.7 : 0.13;
    }

    function updateTrail(s: OrbitSatellite, date: Date) {
      const obj = satObjects.get(s.id);
      if (!obj) return;
      const pts: number[] = [];
      for (let i = 0; i <= 26; i++) {
        const t = new Date(date.getTime() - (i / 26) * 9 * 60000);
        const p = propagateAt(s, t);
        if (!p) continue;
        pts.push(...latLonToVec3(p.lat, p.lon, RADIUS * (1 + p.altKm / EARTH_R)));
      }
      setLine(obj.trail, pts);
    }

    const satStats: { id: string; lat: number; lon: number; alt: number; covered: boolean }[] = [];

    function updateSatellites(date: Date) {
      for (const s of sats) {
        const obj = satObjects.get(s.id);
        if (!obj) continue;
        const p = propagateAt(s, date);
        if (!p) continue;
        const v = latLonToVec3(p.lat, p.lon, RADIUS * (1 + p.altKm / EARTH_R));
        obj.mesh.position.set(...v);
        obj.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...v).normalize());
        const nadir = latLonToVec3(p.lat, p.lon, RADIUS * 1.002);
        setLine(obj.tether, [...v, ...nadir]);
        const selected = selectedRef.current === s.id;
        obj.halo.scale.setScalar(selected ? 0.11 : 0.06);
        obj.halo.material.opacity = selected ? 1 : 0.7;
        const region = storeRef.current.region;
        const cover = swathCovers(s, date, region.center[0], region.center[1]);
        satStats.push({ id: s.id, lat: p.lat, lon: p.lon, alt: p.altKm, covered: cover.covered });
      }
      if (satStats.length) onSatStatsRef.current?.(satStats.splice(0, satStats.length));
    }

    // --- labels / projections --------------------------------------------
    const tmp = new THREE.Vector3();
    const segDir = new THREE.Vector3();
    const nearest = new THREE.Vector3();
    function hiddenBehindEarth(v: THREE.Vector3): boolean {
      // True when the line of sight from the camera to `v` passes through the globe.
      segDir.subVectors(v, camera.position);
      const t = Math.max(0, Math.min(0.999, -camera.position.dot(segDir) / Math.max(1e-6, segDir.lengthSq())));
      nearest.copy(camera.position).addScaledVector(segDir, t);
      return nearest.length() < RADIUS * 0.997;
    }
    function project(lat: number, lon: number, radius = 1.03): { x: number; y: number; visible: boolean } {
      const v = latLonToVec3(lat, lon, radius);
      tmp.set(...v);
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * mountEl.clientWidth;
      const y = (-tmp.y * 0.5 + 0.5) * mountEl.clientHeight;
      tmp.set(...v);
      return { x, y, visible: !hiddenBehindEarth(tmp) };
    }

    // Labels float above the globe but must never collide with the interface cards laid over
    // it, so their screen boxes are cached and any label under a card is suppressed.
    const uiExclusions: { l: number; t: number; r: number; b: number }[] = [];
    let exclusionsAt = -1e9;
    function refreshExclusions(now: number) {
      if (now - exclusionsAt < 400) return;
      exclusionsAt = now;
      uiExclusions.length = 0;
      const host = mountEl.closest('.watch') ?? document;
      const mr = mountEl.getBoundingClientRect();
      for (const el of host.querySelectorAll('.watch-hero, .watch-constellation, .watch-alert, .watch-regions, .watch-badges, .watch-timeline')) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        uiExclusions.push({ l: r.left - mr.left - 8, t: r.top - mr.top - 6, r: r.right - mr.left + 8, b: r.bottom - mr.top + 6 });
      }
    }
    function underInterface(x: number, y: number): boolean {
      for (const e of uiExclusions) if (x > e.l && x < e.r && y > e.t && y < e.b) return true;
      return false;
    }

    function updateLabels(simDate: Date) {
      refreshExclusions(performance.now());
      for (const l of regionLabels) {
        const p = project(l.lat, l.lon, 1.02);
        l.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        const free = p.x > 8 && p.x < mountEl.clientWidth - 8 && p.y > 8 && p.y < mountEl.clientHeight - 8;
        l.el.style.opacity = p.visible && free && !underInterface(p.x, p.y) ? '0.85' : '0';
      }
      for (const s of sats) {
        const obj = satObjects.get(s.id);
        if (!obj) continue;
        const p = propagateAt(s, simDate);
        if (!p) continue;
        const v = latLonToVec3(p.lat, p.lon, RADIUS * (1 + p.altKm / EARTH_R));
        tmp.set(...v).project(camera);
        const x = (tmp.x * 0.5 + 0.5) * mountEl.clientWidth;
        const y = (-tmp.y * 0.5 + 0.5) * mountEl.clientHeight;
        const camDist = camera.position.distanceTo(tmp.set(...v));
        obj.label.style.transform = `translate(${x}px, ${y}px)`;
        const shown = camDist <= 6.5 && !hiddenBehindEarth(tmp.set(...v)) && !underInterface(x, y);
        obj.label.style.opacity = shown ? '0.95' : '0';
        obj.label.style.pointerEvents = shown ? 'auto' : 'none';
      }
    }

    // --- sun --------------------------------------------------------------
    const sunLight = new THREE.DirectionalLight(0xfff2cc, 2.0);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x223850, 1.1));
    const fill = new THREE.DirectionalLight(0x4a7fb5, 0.45);
    fill.position.set(-2, -1, -2);
    scene.add(fill);

    const worldSun = new THREE.Vector3(1, 0, 0);
    function updateSun(date: Date) {
      const [lat, lon] = subsolarPoint(date);
      const v = latLonToVec3(lat, lon, 1);
      worldSun.set(v[0], v[1], v[2]).normalize();
      sunLight.position.set(v[0] * 5, v[1] * 5, v[2] * 5);
      earthMat.uniforms.sunDir.value.copy(worldSun);
      atmoInner.mat.uniforms.sunDir.value.copy(worldSun);
      atmoOuter.mat.uniforms.sunDir.value.copy(worldSun);
    }

    // --- picking ----------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;

    function pick(ev: PointerEvent): boolean {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const objs: THREE.Object3D[] = [earth, ...markerHitMeshes, ...markerRings, ...markerDots, ...satGroup.children];
      const hits = raycaster.intersectObjects(objs, true);
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        while (o && !o.userData.pick) o = o.parent;
        if (!o) continue;
        if (o.userData.pick === 'satellite') {
          const id = o.userData.satId as string;
          onSelectSat(id);
          apiRef.current?.setSelected(id);
          return true;
        }
        if (o.userData.pick === 'region') {
          const rid = o.userData.regionId as string;
          const target = REGIONS.find((r) => r.id === rid);
          storeRef.current.selectRegion(rid);
          onToast(`${target?.shortName ?? 'Region'} selected — the Atlas is ready.`);
          if (target) apiRef.current?.focusLatLon(target.center[0], target.center[1], 2.35);
          return true;
        }
        if (o.userData.pick === 'earth') {
          const p = hit.point;
          const [lat, lon] = vec3ToLatLon(p.x, p.y, p.z);
          const la = Number(lat.toFixed(2));
          const lo = Number(normalizeLon(lon).toFixed(2));
          apiRef.current?.focusLatLon(lat, lon, 1.9);
          void whereAt(la, lo).then((w) => {
            if (w.country && w.nearKm === null) {
              // The point is inside a published border, so select that border's own record instead of a
              // 150 km circle around wherever the cursor happened to land.
              const cw = countryWindow(w.country.id);
              storeRef.current.selectCountry(w.country.id);
              onToast(
                cw
                  ? `${w.label} selected country-wide — ${cw.total.toLocaleString()} detections measured inside its border in this window.`
                  : windowMeta_()
                    ? `${w.label} selected country-wide — no detection inside its border in this window.`
                    : `${w.label} selected country-wide.`,
              );
              return;
            }
            // Water, or land less than one probe ring from a border: keep the point-centred AOI, because
            // the whole country would not be the area under the cursor.
            storeRef.current.selectCustom(la, lo, 150, w.country ? w.label : undefined, w.country?.id);
            onToast(
              w.country
                ? `${w.label} selected — the point is ~${w.nearKm} km off its border: a 150 km AOI, measured against ${w.country.name}'s own window.`
                : `Open ocean at ${la}°, ${lo}° selected as a 150 km AOI — no country border contains it.`,
            );
          });
          return true;
        }
      }
      return false;
    }

    const onPointerDown = (ev: PointerEvent) => {
      down = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const hit = pick(ev);
      if (!hit) {
        onSelectSat(null);
        apiRef.current?.setSelected(null);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // --- camera focus -----------------------------------------------------
    let focusTween: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
    function focusLatLon(lat: number, lon: number, dist = 2.4) {
      const v = latLonToVec3(lat, lon, dist);
      focusTween = { from: camera.position.clone(), to: new THREE.Vector3(...v), t: 0 };
      controls.autoRotate = false;
      window.setTimeout(() => {
        controls.autoRotate = !storeRef.current.settings.reduceMotion;
      }, 9000);
    }
    // --- close-zoom detail ------------------------------------------------
    // The 8K mosaic is the widest global source NASA GIBS publishes in one image; beyond
    // roughly a hemisphere it runs out of pixels. Each pilot region therefore carries a
    // baked 4096 px GIBS crop, shown only while the camera is close and centred inside it.
    let detailReady = false;
    let detailBox: { w: number; s: number; e: number; n: number } | null = null;
    let detailDay: THREE.Texture | null = null;
    let detailNight: THREE.Texture | null = null;
    let detailToken = 0;
    const configureDetail = (tex: THREE.Texture) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
    };
    const loadDetailTexture = (url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(url, (tex) => { configureDetail(tex); resolve(tex); }, undefined, reject);
      });
    const applyDetail = (region: Region) => {
      const pilot = REGIONS.some((r) => r.id === region.id);
      const box = fittedMapBounds(region.bbox, 736 / 396);
      detailBox = box;
      const rect = earthMat.uniforms.detailRect.value as THREE.Vector4;
      rect.set((box.w + 180) / 360, (box.s + 90) / 180, (box.e - box.w) / 360, (box.n - box.s) / 180);
      const token = ++detailToken;
      detailReady = false;
      const dayUrl = pilot ? `${BASE}data/basemaps/${region.id}.jpg` : gibsBasemapUrl(box);
      const nightUrl = pilot
        ? `${BASE}data/basemaps/${region.id}_night.jpg`
        : gibsBasemapUrl(box, 'VIIRS_CityLights_2012');
      Promise.all([loadDetailTexture(dayUrl), loadDetailTexture(nightUrl)])
        .then(([d, n]) => {
          if (token !== detailToken) {
            d.dispose();
            n.dispose();
            return;
          }
          detailDay?.dispose();
          detailNight?.dispose();
          detailDay = d;
          detailNight = n;
          earthMat.uniforms.dayDetail.value = d;
          earthMat.uniforms.nightDetail.value = n;
          detailReady = true;
        })
        .catch(() => {
          if (token === detailToken) detailReady = false;
        });
    };
    detailRequestRef.current = applyDetail;
    applyDetail(storeRef.current.region);

    // --- viewport detail --------------------------------------------------
    // The 8K mosaic runs out of pixels as the camera closes in, so the visible window is
    // re-fetched from NASA GIBS once the camera settles. The keyless WMS crop is real
    // Blue Marble / VIIRS imagery; nothing here is synthesised.
    const VIEW_SIZE: [number, number] = [4096, 2204];
    const VIEW_STEPS = [3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 27, 33, 40, 48, 58];
    const viewCache = new Map<string, { day: THREE.Texture; night: THREE.Texture }>();
    let viewDay: THREE.Texture | null = null;
    let viewNight: THREE.Texture | null = null;
    let viewBox: { w: number; s: number; e: number; n: number } | null = null;
    let viewReady = false;
    let viewScheduled = '';
    let viewToken = 0;
    let viewTimer = 0;

    const viewKeyFor = (b: { w: number; s: number; e: number; n: number }) =>
      [b.w, b.s, b.e, b.n].map((v) => v.toFixed(2)).join(',');

    function viewWindow(lat: number, lon: number, dist: number) {
      const halfV = THREE.MathUtils.degToRad(18);
      const aspect = mountEl.clientWidth / Math.max(1, mountEl.clientHeight);
      const halfH = Math.atan(Math.tan(halfV) * aspect);
      const vSpan = 2 * Math.asin(Math.min(0.98, (dist - 1) * Math.tan(halfV))) * (180 / Math.PI);
      const hSpan = 2 * Math.asin(Math.min(0.98, (dist - 1) * Math.tan(halfH))) * (180 / Math.PI);
      let latSpan = Math.min(58, Math.max(3, vSpan * 1.2));
      for (const s of VIEW_STEPS) {
        if (latSpan <= s) {
          latSpan = s;
          break;
        }
      }
      const cos = Math.max(0.18, Math.cos(THREE.MathUtils.degToRad(lat)));
      const lonSpan = Math.min(160, Math.max(5, (hSpan * 1.2) / cos));
      const latStep = Math.max(0.2, latSpan / 10);
      const lonStep = Math.max(0.2, lonSpan / 10);
      const cLat = Math.round(lat / latStep) * latStep;
      const cLon = Math.round(lon / lonStep) * lonStep;
      const w = Math.max(-180, Math.min(180 - lonSpan, cLon - lonSpan / 2));
      const s = Math.max(-89.4, Math.min(89.4 - latSpan, cLat - latSpan / 2));
      return { w, s, e: w + lonSpan, n: s + latSpan };
    }

    const adoptView = (box: { w: number; s: number; e: number; n: number }, key: string) => {
      const entry = viewCache.get(key);
      if (!entry) return;
      viewDay = entry.day;
      viewNight = entry.night;
      earthMat.uniforms.viewDay.value = entry.day;
      earthMat.uniforms.viewNight.value = entry.night;
      const rect = earthMat.uniforms.viewRect.value as THREE.Vector4;
      rect.set((box.w + 180) / 360, (box.s + 90) / 180, (box.e - box.w) / 360, (box.n - box.s) / 180);
      viewBox = box;
      viewReady = true;
    };

    function scheduleView(box: { w: number; s: number; e: number; n: number }, key: string) {
      viewScheduled = key;
      window.clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        if (viewCache.has(key)) {
          adoptView(box, key);
          return;
        }
        const token = ++viewToken;
        Promise.all([
          loadDetailTexture(gibsBasemapUrl(box, undefined, VIEW_SIZE)),
          loadDetailTexture(gibsBasemapUrl(box, 'VIIRS_CityLights_2012', VIEW_SIZE)),
        ])
          .then(([d, n]) => {
            if (token !== viewToken) {
              d.dispose();
              n.dispose();
              return;
            }
            if (viewCache.size >= 2) {
              for (const [k, entry] of viewCache) {
                if (k !== key) {
                  viewCache.delete(k);
                  entry.day.dispose();
                  entry.night.dispose();
                  break;
                }
              }
            }
            viewCache.set(key, { day: d, night: n });
            adoptView(box, key);
          })
          .catch(() => undefined);
      }, 650);
    }

    apiRef.current = {
      focusLatLon,
      reset: () => {
        simMs = Date.now();
        focusLatLon(storeRef.current.region.center[0], storeRef.current.region.center[1], 2.62);
      },
      setSelected: (id: string | null) => {
        if (!id) return;
        const s = sats.find((x) => x.id === id);
        if (!s) return;
        const p = propagateAt(s, new Date(simMs));
        if (p) focusLatLon(p.lat, p.lon, 2.15);
      },
      seek: (ms: number) => {
        simMs = ms;
        onTick(ms);
      },
    };

    // --- resize -----------------------------------------------------------
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = Math.max(1, mount.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    // --- loop -------------------------------------------------------------
    let raf = 0;
    let tickClock = 0;
    let smoothTime = performance.now();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.1, (now - smoothTime) / 1000);
      smoothTime = now;
      if (playingRef.current) simMs += dt * 1000 * speedRef.current;
      const simDate = new Date(simMs);

      if (focusTween) {
        focusTween.t = Math.min(1, focusTween.t + dt * 1.7);
        const e = 1 - Math.pow(1 - focusTween.t, 3);
        camera.position.lerpVectors(focusTween.from, focusTween.to, e);
        if (focusTween.t >= 1) focusTween = null;
      }
      const camDist = camera.position.length();
      // Hold the view still while inspecting a region; the slow spin resumes once zoomed out.
      controls.autoRotate = !storeRef.current.settings.reduceMotion && camDist > 2.55;
      controls.update();
      const zoomMix = 1 - THREE.MathUtils.smoothstep(camDist, 1.55, 2.45);
      let wantDetail = 0;
      if (detailReady && detailBox && zoomMix > 0) {
        const [cLat, cLon] = vec3ToLatLon(camera.position.x, camera.position.y, camera.position.z);
        if (cLat >= detailBox.s && cLat <= detailBox.n && cLon >= detailBox.w && cLon <= detailBox.e) {
          wantDetail = zoomMix;
        }
      }
      const mixUniform = earthMat.uniforms.detailMix;
      mixUniform.value += (wantDetail - (mixUniform.value as number)) * Math.min(1, dt * 5);

      // Below this distance the camera stops auto-rotating, so the viewport crop is stable; above it
      // the blend is negligible and refetching every rotation step just burns GIBS requests.
      let wantView = 0;
      if (camDist < 2.55) {
        const [cLat, cLon] = vec3ToLatLon(camera.position.x, camera.position.y, camera.position.z);
        const box = viewWindow(cLat, cLon, camDist);
        const key = viewKeyFor(box);
        if (key !== viewScheduled) scheduleView(box, key);
        if (viewReady && viewBox && cLat >= viewBox.s && cLat <= viewBox.n && cLon >= viewBox.w && cLon <= viewBox.e) {
          wantView = 1 - THREE.MathUtils.smoothstep(camDist, 2.3, 2.7);
        }
      } else {
        window.clearTimeout(viewTimer);
        viewScheduled = '';
      }
      const viewUniform = earthMat.uniforms.viewMix;
      viewUniform.value += (wantView - (viewUniform.value as number)) * Math.min(1, dt * 4);
      updateSun(simDate);
      starsFar.rotation.y += dt * 0.0022;
      starsNear.rotation.y -= dt * 0.0014;

      // Markers are world-space geometry, so at close zoom they would balloon to hundreds of
      // pixels. Scaling each marker by its distance to the camera keeps it the same size on
      // screen from orbit height down to the 1.09 minimum distance.
      for (let i = 0; i < markerRings.length; i++) {
        const ring = markerRings[i];
        const d = camera.position.distanceTo(ring.position);
        const k = Math.min(3, Math.max(0.03, d / 2.1));
        ring.userData.phase = (ring.userData.phase ?? 0) + dt * 0.7;
        ring.scale.setScalar(k * (1 + 0.16 * Math.sin(ring.userData.phase)));
        markerDots[i].scale.setScalar(k);
        markerHitMeshes[i].scale.setScalar(k);
      }

      updateSatellites(simDate);
      updateLabels(simDate);

      orbitClock += dt;
      if (orbitClock > 1.2) {
        orbitClock = 0;
        for (const s of sats) {
          updateOrbit(s, simDate);
          updateTrail(s, simDate);
        }
      }
      ringClock += dt;
      if (ringClock > 8) {
        ringClock = 0;
        for (const s of sats) buildRing(s, simDate);
      }

      tickClock += dt;
      if (tickClock > 0.25) {
        tickClock = 0;
        onTick(simMs);
      }

      renderer.render(scene, camera);
    };
    animate();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') apiRef.current?.reset();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fireRebuildRef.current = null;
      detailRequestRef.current = null;
      detailToken++;
      viewToken++;
      window.clearTimeout(viewTimer);
      for (const entry of viewCache.values()) {
        entry.day.dispose();
        entry.night.dispose();
      }
      viewCache.clear();
      window.removeEventListener('keydown', onKey);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      dayTex.dispose();
      nightTex.dispose();
      detailDay?.dispose();
      detailNight?.dispose();
      earthMat.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      labelLayer.remove();
    };
  }, [onSelectSat, onTick, onToast]);

  return <div className="globe-canvas" ref={mountRef} role="application" aria-label="Orbital watch. Drag to rotate Earth, scroll to zoom, click a satellite to focus." />;
}));
