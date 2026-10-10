/** Google Maps style: aged-paper map so the archival layer feels at home. */
export const SEPIA_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#efe4d0' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5c4a36' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5eddf' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#d9d2b4' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#fbf6ec' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#f3e6cc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8d2a8' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#b9c7c4' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#c9b28f' }] },
];
