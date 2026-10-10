import type { MonumentMapItem, PhotoSummary } from '@echoes/shared';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { BBox } from '@/lib/api';
import { leafletHtml } from '@/lib/leaflet-html';

export type LeafletMapHandle = { flyTo: (lat: number, lon: number, zoom: number) => void };

type Props = {
  ref?: Ref<LeafletMapHandle>;
  initialCenter: { lat: number; lon: number };
  initialZoom: number;
  monuments: MonumentMapItem[];
  photos: PhotoSummary[];
  selectedPhotoId: string | null;
  me: { lat: number; lon: number } | null;
  onRegionChange: (bbox: BBox, zoom: number) => void;
  onSelectPhoto: (id: string) => void;
  onSelectMonument: (inspireId: string) => void;
  onPress: () => void;
};

type MapMessage =
  | { type: 'ready' }
  | { type: 'region'; bbox: BBox; zoom: number }
  | { type: 'photo'; id: string }
  | { type: 'monument'; id: string }
  | { type: 'press' };

export function LeafletMap({ ref, initialCenter, initialZoom, monuments, photos, selectedPhotoId, me, onRegionChange, onSelectPhoto, onSelectMonument, onPress }: Props) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // The page is built once; later updates go through injected calls so the map keeps its viewport.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => leafletHtml(initialCenter, initialZoom), []);
  const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);

  useImperativeHandle(ref, () => ({ flyTo: (lat, lon, zoom) => run(`flyTo(${lat},${lon},${zoom})`) }));

  useEffect(() => {
    if (!ready) return;
    const slim = monuments.map((m) => (m.kind === 'cluster' ? { a: m.lat, o: m.lon, c: m.count } : { a: m.lat, o: m.lon, i: m.inspireId }));
    run(`setMonuments(${JSON.stringify(slim)})`);
  }, [ready, monuments]);

  useEffect(() => {
    if (!ready) return;
    const slim = photos.map((p) => ({ a: p.lat, o: p.lon, i: p.id, y: p.yearFrom }));
    run(`setPhotos(${JSON.stringify(slim)},${JSON.stringify(selectedPhotoId)})`);
  }, [ready, photos, selectedPhotoId]);

  useEffect(() => {
    if (ready && me) run(`setMe(${me.lat},${me.lon})`);
  }, [ready, me?.lat, me?.lon]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: MapMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as MapMessage;
    } catch {
      return;
    }
    if (msg.type === 'ready') setReady(true);
    else if (msg.type === 'region') onRegionChange(msg.bbox, msg.zoom);
    else if (msg.type === 'photo') onSelectPhoto(msg.id);
    else if (msg.type === 'monument') onSelectMonument(msg.id);
    else if (msg.type === 'press') onPress();
  };

  return (
    <WebView
      ref={web}
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://echoes.app/' }}
      onMessage={onMessage}
      style={StyleSheet.absoluteFill}
      setSupportMultipleWindows={false}
      overScrollMode="never"
    />
  );
}
