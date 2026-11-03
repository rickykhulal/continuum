import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { searchWorld, loadWorldLayer, countryWindow, type WorldHit } from '../lib/countries';
import { nf } from '../lib/format';
import { PLACES } from '../data/places';

/**
 * Type-ahead over every country border in the bundle, plus the curated places. The globe accepts a
 * click anywhere; this makes the same coverage reachable from the keyboard and from a touch screen,
 * where a 3 px hit on a spinning planet is not a realistic interaction.
 */
export function WorldSearch({ onFocusGlobe }: { onFocusGlobe?: (center: [number, number]) => void }) {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadWorldLayer();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const results: WorldHit[] = query.trim().length >= 2 ? searchWorld(query, 7, PLACES) : [];

  const choose = (p: WorldHit) => {
    if (p.kind === 'country') {
      store.selectCountry(p.id);
      const w = countryWindow(p.id);
      store.toast(
        w
          ? `${p.name}: country-wide, ${nf(w.total)} detections measured inside its border this window.`
          : `${p.name}: country-wide, no detection inside its border in this window.`,
      );
    } else if (p.regionId) {
      store.selectRegion(p.regionId);
      store.toast(`${p.name} loaded — pilot region with a curated long record.`);
    } else {
      store.selectCustom(p.lat, p.lon, 140, p.name);
      store.toast(`${p.name} opened as a custom 140 km AOI.`);
    }
    onFocusGlobe?.([p.lat, p.lon]);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="world-search" ref={box}>
      <input
        type="search"
        className="world-search-input"
        value={query}
        placeholder="Search any country — India, Kenya, France…"
        aria-label="Search every country in the world"
        aria-expanded={open && results.length > 0}
        aria-controls="world-results"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) choose(results[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <ul className="place-results world-results" id="world-results" role="listbox">
          {results.map((p) => (
            <li key={`${p.kind}-${p.id}`} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.sub}</small>
                </span>
                <span className="mono">{p.lat.toFixed(2)}°, {p.lon.toFixed(2)}°</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && results.length === 0 && (
        <p className="place-empty" role="status">
          No country matches “{query.trim()}” — click the globe instead: any point becomes an area.
        </p>
      )}
    </div>
  );
}
