import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { REGIONS } from '../lib/data';
import { PLACES } from '../data/places';
import { searchWorld, loadWorldLayer, countryWindow, type WorldHit } from '../lib/countries';
import { nf } from '../lib/format';
import { Badge } from './ui';
import { motion } from 'framer-motion';
import { DrawArea } from './DrawArea';

export function AreaBar({ compact = false }: { compact?: boolean }) {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState(store.region.center[0].toFixed(2));
  const [lon, setLon] = useState(store.region.center[1].toFixed(2));
  const [radius, setRadius] = useState(String(Math.round(Math.sqrt(store.region.areaKm2 / Math.PI))));
  const [drawOpen, setDrawOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLat(store.region.center[0].toFixed(2));
    setLon(store.region.center[1].toFixed(2));
    setRadius(String(Math.round(Math.sqrt(store.region.areaKm2 / Math.PI))));
    setQuery('');
  }, [store.region.id, store.region.center, store.region.areaKm2]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    void loadWorldLayer();
  }, []);

  const results: WorldHit[] = query.trim() ? searchWorld(query, 8, PLACES) : [];

  const choose = (p: WorldHit) => {
    if (p.kind === 'country') {
      store.selectCountry(p.id);
      const w = countryWindow(p.id);
      store.toast(
        w
          ? `${p.name} framed country-wide — ${nf(w.total)} detections measured in this window.`
          : `${p.name} framed country-wide — no detection in this window, so the record runs on its seasonal climatology.`,
      );
    } else if (p.regionId) {
      store.selectRegion(p.regionId);
      store.toast(`${p.name} loaded — pilot region with a curated long record.`);
    } else {
      store.selectCustom(p.lat, p.lon, 140, p.name);
      store.toast(`${p.name} opened as a custom 140 km AOI.`);
    }
    setOpen(false);
    setQuery('');
  };

  const apply = () => {
    const la = Number(lat);
    const lo = Number(lon);
    const ra = Math.max(20, Math.min(800, Number(radius) || 140));
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
      store.toast('Enter a latitude between −90 and 90 and a longitude between −180 and 180.');
      return;
    }
    store.selectCustom(la, lo, ra);
    store.toast(`Custom ${ra} km area opened at ${la.toFixed(2)}°, ${lo.toFixed(2)}°.`);
  };

  const share = async () => {
    const url = await store.shareLink();
    store.toast(`View link ready — ${url}`);
  };

  const isPilot = REGIONS.some((r) => r.id === store.region.id);
  const latest = store.records.find(r => r.date === store.today);
  const observedLatest = latest?.source === 'live';

  return (
    <div className={`area-bar ${compact ? 'area-bar-compact' : ''}`}>
      <div className="area-search" ref={boxRef}>
        <label className="field">
          <span className="field-label">Search a place</span>
          <input
            type="search"
            value={query}
            placeholder="Any country, or Chilecito, Pantanal, Greece…"
            aria-label="Search every country or a named place"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            aria-expanded={open && results.length > 0}
            aria-controls="place-results"
          />
        </label>
        {open && results.length === 0 && query.trim().length >= 2 && (
          <p className="place-empty" role="status">
            No country or place matches “{query.trim()}”. Type at least two letters of a country name, or click the globe anywhere.
          </p>
        )}
        {open && results.length > 0 && (
          <ul className="place-results" id="place-results" role="listbox">
            {results.map((p) => (
              <li key={`${p.kind}-${p.id}`} role="option" aria-selected={false}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.sub}</small>
                  </span>
                  <span className="mono">{p.lat.toFixed(2)}°, {p.lon.toFixed(2)}°</span>
                  {p.kind === 'country' ? <Badge tone="live">country</Badge> : p.regionId ? <Badge tone="good">pilot</Badge> : <Badge tone="warn">place</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="area-coords">
        <label className="field">
          <span className="field-label">Latitude</span>
          <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-label="Latitude in decimal degrees" />
        </label>
        <label className="field">
          <span className="field-label">Longitude</span>
          <input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} aria-label="Longitude in decimal degrees" />
        </label>
        <label className="field">
          <span className="field-label">{store.region.selection === 'bounds' ? 'New radius (km)' : 'Radius (km)'}</span>
          <input inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} aria-label="Radius in kilometres" />
        </label>
        <button type="button" className="btn btn-primary btn-small" onClick={apply}>{store.region.selection === 'bounds' ? 'Use circle' : 'Analyze'}</button>
      </div>

      <div className="area-presets">
        <span className="field-label">Pilot regions</span>
        <div className="preset-row">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`preset ${r.id === store.regionId ? 'active' : ''}`}
              onClick={() => {
                store.selectRegion(r.id);
                store.toast(`${r.name} loaded.`);
              }}
            >
              {r.shortName}
            </button>
          ))}
        </div>
      </div>

      <div className="area-actions">
        {isPilot ? (
          <button
            type="button"
            className={`btn btn-small ${store.watchlist.includes(store.region.id) ? 'btn-live' : 'btn-ghost'}`}
            onClick={() => {
              store.toggleWatch(store.region.id);
              store.toast(
                store.watchlist.includes(store.region.id)
                  ? `${store.region.shortName} removed from the watchlist.`
                  : `${store.region.shortName} added to the watchlist and risk radar.`,
              );
            }}
          >
            {store.watchlist.includes(store.region.id) ? '● Watching' : '○ Watch area'}
          </button>
        ) : (
          <Badge tone="warn">custom AOI</Badge>
        )}
        <span><Badge tone={observedLatest ? 'live' : 'default'} pulse={observedLatest}>{observedLatest ? 'LIVE' : latest?.source === 'archive' ? 'ARCHIVE' : 'RECONSTRUCTION'}: {store.today}</Badge></span>
        <button
          type="button"
          className={`btn btn-small ${drawOpen ? 'btn-live' : 'btn-ghost'}`}
          aria-expanded={drawOpen}
          aria-controls="draw-area-panel"
          onClick={() => setDrawOpen((v) => !v)}
        >
          {drawOpen ? '✕ Close drawing' : '✎ Draw an area'}
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={share}>Share view</button>
        <span className="area-fact">{nf(store.region.areaKm2)} km² · {store.region.selection === 'bounds' ? 'geographic rectangle' : store.region.biome}</span>
      </div>

      {drawOpen && (
        <div className="area-draw" id="draw-area-panel">
          <DrawArea />
        </div>
      )}
    </div>
  );
}
