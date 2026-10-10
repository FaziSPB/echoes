/**
 * Leaflet + OpenStreetMap tiles in a WebView: no API key, works in Expo Go and any build.
 * (OSM tile policy: attribution shown, light demo traffic, page served with an https base URL so tiles get a Referer.)
 * Clustering is done server-side (PostGIS), so the page only draws what it is given. Updates are diffed by key and
 * single monuments are canvas circles, so panning does not rebuild hundreds of DOM markers.
 * Only ids, coordinates and years cross the bridge – no free text is injected into the page.
 */
export function leafletHtml(center: { lat: number; lon: number }, zoom: number): string {
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
html,body,#map{margin:0;height:100%;background:#efe4d0}
.leaflet-tile-pane{filter:sepia(.55) saturate(.75) contrast(.95) brightness(1.03)}
.cl{border-radius:999px;background:rgba(107,90,72,.8);border:2px solid #F3EADB;color:#F3EADB;font:700 11px sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.ph{height:28px;padding:0 9px;border-radius:14px;background:#8B5E34;border:2px solid #fff;color:#fff;font:700 13px serif;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);box-sizing:border-box}
.ph.sel{background:#2B2118;transform:scale(1.15)}
.me{width:16px;height:16px;border-radius:8px;background:#3B8FE0;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,143,224,.25);box-sizing:border-box}
.leaflet-control-attribution{font-size:9px;background:rgba(243,234,219,.85)!important}
</style></head><body><div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var map=L.map('map',{zoomControl:false,preferCanvas:true,renderer:L.canvas({tolerance:8})}).setView([${center.lat},${center.lon}],${zoom});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
var monuments=L.layerGroup().addTo(map),photos=L.layerGroup().addTo(map),me=null,mIndex={},pIndex={};
var icon=function(html,w,h){return L.divIcon({className:'',html:html,iconSize:[w,h]})};
var region=function(){var b=map.getBounds();post({type:'region',bbox:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],zoom:map.getZoom()})};
map.on('moveend',region);
map.on('click',function(){post({type:'press'})});
/* Keep existing layers whose key is still present; add/remove only the difference. */
var sync=function(group,index,items,keyOf,make){var next={};items.forEach(function(it){next[keyOf(it)]=it});
  Object.keys(index).forEach(function(k){if(!next[k]){group.removeLayer(index[k]);delete index[k]}});
  Object.keys(next).forEach(function(k){if(!index[k])index[k]=make(next[k]).addTo(group)})};
window.setMonuments=function(items){sync(monuments,mIndex,items,
  function(m){return m.c?'c'+m.a.toFixed(5)+','+m.o.toFixed(5)+':'+m.c:'m'+m.i},
  function(m){
    if(m.c){var s=Math.round(26+Math.min(m.c,60)/3);return L.marker([m.a,m.o],{icon:icon('<div class="cl" style="width:'+s+'px;height:'+s+'px">'+m.c+'</div>',s,s)}).on('click',function(){map.setView([m.a,m.o],map.getZoom()+2)})}
    return L.circleMarker([m.a,m.o],{radius:5,weight:2,color:'#F3EADB',fillColor:'#6B5A48',fillOpacity:1,bubblingMouseEvents:false}).on('click',function(){post({type:'monument',id:m.i})})
  })};
window.setPhotos=function(items,sel){sync(photos,pIndex,items,
  function(p){return p.i+(p.i===sel?':sel':'')},
  function(p){return L.marker([p.a,p.o],{zIndexOffset:1000,icon:icon('<div class="ph'+(p.i===sel?' sel':'')+'">'+(p.y||'?')+'</div>',52,28)}).on('click',function(){post({type:'photo',id:p.i})})})};
window.setMe=function(a,o){if(!me){me=L.marker([a,o],{interactive:false,icon:icon('<div class="me"></div>',16,16)}).addTo(map)}else{me.setLatLng([a,o])}};
window.flyTo=function(a,o,z){map.flyTo([a,o],z)};
post({type:'ready'});region();
</script></body></html>`;
}
