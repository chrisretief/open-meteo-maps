// @ts-nocheck

import * as maplibregl from 'maplibre-gl';
import { OmFileReader, MemoryHttpBackend, OmDataType } from '@openmeteo/file-reader';
import { omProtocol } from './om-protocol';

import { domainOptions } from './lib/utils/domains';
import { variableOptions } from './lib/utils/variables';
import { getIndicesFromBounds, getIndexFromLatLong } from './lib/utils/math';
import { OMapsFileReader } from './omaps-reader';
import { interpolateLinear } from './lib/utils/interpolations';
import { get } from 'svelte/store';
import LatLon from 'geodesy/latlon-spherical.js';

import {
	time as t,
	loading,
	domain as d,
	variables,
	modelRun as mR,
	mapBounds as mB,
	preferences as p,
	paddedBounds as pB,
	paddedBoundsLayer,
	paddedBoundsSource as pBS,
	paddedBoundsGeoJSON,
	variableSelectionExtended
} from './lib/stores/preferences';

let samples = 72; // 6 hours
let interval = 60 * 5; // 5 min,  in seconds

const { log } = console;
const { floor } = Math;
const pad = (n) => ('0' + n).slice(-2);

let marker;
let bbox;
let map;
let data = { data: null, ranges: null };
let myOmapsFileReader;
let h1 = 60 * 60 * 1000;
let lastTrajTime = 0;
let maxSegs = 120; // 120 hours
const dataCache = [];

function initTrajModule(m) {
	map = m;
	for (let i = 0; i < maxSegs; i++) {
		map.addSource('trajectory_' + i, {
			type: 'geojson',
			data: {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: []
				}
			}
		});
		map.addLayer({
			id: 'trajectory_' + i,
			type: 'line',
			source: 'trajectory_' + i,
			layout: {
				'line-join': 'round',
				'line-cap': 'round'
			},
			paint: {
				'line-color': i % 2 ? 'black' : 'white',
				'line-width': 5
			}
		});
	}
}

const getUrl = (time = new Date()) => {
	const domain = get(d);
	const modelRun = get(mR);
	const hours = pad(floor(time.getUTCHours() / domain.time_interval) * domain.time_interval);
	let url = `https://map-tiles.open-meteo.com/data_spatial/${domain.value}/${modelRun.getUTCFullYear()}/${pad(modelRun.getUTCMonth() + 1)}/${pad(modelRun.getUTCDate())}/${pad(modelRun.getUTCHours())}00Z/${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${hours}00.om`;
	return url;
};

function getData(lat, lng, time = new Date()) {
	let domain = get(d);

	// 1st check if cached.  todo manage cache
	let activeData = dataCache.find(
		(d) =>
			d.bounds[0] < lat &&
			d.bounds[2] > lat &&
			d.bounds[1] < lng &&
			d.bounds[3] > lng &&
			domain.label == d.model &&
			floor(new Date(time) / (h1 * domain.time_interval)) * (h1 * domain.time_interval) ==
				new Date(d.time).getTime()
	);

	if (activeData) {
		return Promise.resolve(activeData);
	}

	let url = getUrl(time);
	let timeStr = url.match(/Z\/(.*).om/)[1];
	let v = get(variables);
	let { label } = v[0];
	let lvl = label.split(' ')[1];
    if (!lvl || !(lvl.includes("hPa") || lvl.includes("10m"))) lvl="10m";

	let variable = {
		value: 'wind_u_component_' + lvl,
		label
	};

	let bounds = [lat - 5, lng - 5, lat + 5, lng + 5];

	let boundsIndexes = getIndicesFromBounds(bounds[0], bounds[1], bounds[2], bounds[3], domain);
	let ranges = [
		{ start: boundsIndexes[1], end: boundsIndexes[3] },
		{ start: boundsIndexes[0], end: boundsIndexes[2] }
	];

	if (!myOmapsFileReader) {
		myOmapsFileReader = new OMapsFileReader(domain, true);
	}
	myOmapsFileReader.setReaderData(domain, true);
	return myOmapsFileReader
		.init(url)
		.then(() => {
			return myOmapsFileReader.readVariable(variable, ranges).then((values) => {
				data.data = values;
				data.ranges = ranges;
				data.bounds = bounds;
				data.model = domain.label;
				data.time = new Date(timeStr.slice(0, -2) + ':00' + 'Z');
				dataCache.push(data);
				activeData = data;
				return activeData;

				// prefetch first bytes of the previous and next timesteps to trigger CF caching  ??????? what does this do:
				myOmapsFileReader.prefetch(omUrl);
			});
		})
		.catch((e) => {
			console.log(e);
		});
}

function drawLine(points, ix, previ, i) {
	let lineString = points.filter((p, ii) => ii >= previ && ii <= i).map((p) => [p.lng, p.lat]);
	map.getSource('trajectory_' + ix).setData({
		type: 'Feature',
		geometry: { type: 'LineString', coordinates: lineString }
	});
}

function resetLines() {
	for (let i = 0; i < maxSegs; i++) {
		map.getSource('trajectory_' + i).setData({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: [] }
		});
	}
}

function getSpeedAndDir(data, lat, lng) {
	let ix = getIndexFromLatLong(lat, lng, get(d), data.ranges);
	let speed = interpolateLinear(
		data.data.values,
		ix.index,
		ix.xFraction,
		ix.yFraction,
		data.ranges
	);
	let dir = interpolateLinear(
		data.data.directions,
		ix.index,
		ix.xFraction,
		ix.yFraction,
		data.ranges
	);
	return { speed, dir };
}

function drawTraj(lat, lng, time) {
	resetLines();
	if (Date.now() - lastTrajTime < 1000) return;
	lastTrajTime = Date.now();
	let startIx = floor(time / h1);
	let prevIx = startIx;
	let previ = 0;
	return new Promise((res, rej) => {
		let points = [new LatLon(lat, lng)];
		const nextPoint = (i, p, time) => {
			getData(p.lat, p.lng, time).then((data) => {
				let { speed, dir } = getSpeedAndDir(data, p.lat, p.lng);

				let p2 = p.destinationPoint(speed * interval, dir);
				points.push(p2);

				let newTime = new Date(+time + interval * 1000);
				let newIx = floor(newTime / h1);
				if (newIx > prevIx || i == samples) {  // if in the next hour,  change line style
					drawLine(points, prevIx - startIx, previ, i);
					prevIx = newIx;
					previ = i;
				}
				if (i < samples) {
					nextPoint(i + 1, p2, new Date(+time + interval * 1000));
				} else res(points);
			});
		};

		nextPoint(0, points[0], time);
	}).then((points) => {
		console.log('DONE');
	});
}

function addMarker(map, e) {
	const el = document.createElement('div');
	el.id = 'marker';
	el.innerHTML = `
        <div class="flag"></div>
        <div class="pole"></div>
        <div class="ball"></div>
    `;

	marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
		.setLngLat(e.lngLat)
		.addTo(map);

	function updateCoords() {
		const { lat, lng } = marker.getLngLat();
		getData(lat, lng, get(t)).then((data) => {
			let { speed, dir } = getSpeedAndDir(data, lat, lng);
			el.firstElementChild.innerHTML = `
                Wind: ${speed.toFixed(1)}m/s <br>
                Dir: ${((dir + 180) % 360).toFixed(0)}
            `;
		});

		drawTraj(lat, lng, get(t));
	}

	marker.on('drag', updateCoords);
	updateCoords(); // show initial position
}

function removeMarker() {
	marker?.remove();
}

function lngLatToTile(lng, lat, z) {
	const n = 2 ** z;
	const x = Math.floor(((lng + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
	return { x, y, z };
}

export { addMarker, removeMarker, initTrajModule };
