import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const map = L.map('map').setView([45.757295, 4.832391], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);