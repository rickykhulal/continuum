/** Keyless NASA GIBS WMS crop used for custom AOIs and the globe's close-zoom overlay.
 *  The baked copies in public/data/basemaps cover the seven pilot regions. */
export function gibsBasemapUrl(
  box: { w: number; s: number; e: number; n: number },
  layer = 'BlueMarble_ShadedRelief_Bathymetry',
  size: [number, number] = [4096, 2204],
): string {
  const qs = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: layer,
    STYLES: '',
    FORMAT: 'image/jpeg',
    SRS: 'EPSG:4326',
    BBOX: [box.w, box.s, box.e, box.n].map((v) => v.toFixed(4)).join(','),
    WIDTH: String(size[0]),
    HEIGHT: String(size[1]),
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${qs}`;
}
