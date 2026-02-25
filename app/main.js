import './style.css';
import {Map, View} from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';

const map = new Map({
  target: 'map',
  layers: [ new TileLayer({ source: new OSM()})],
  view: new View({
    center: fromLonLat([4.832391,45.757295]),
    zoom: 15,
  }),
});





