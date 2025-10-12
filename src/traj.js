// @ts-nocheck

import * as maplibregl from 'maplibre-gl';
import { OmFileReader, MemoryHttpBackend, OmDataType } from '@openmeteo/file-reader';
import { getValueFromLatLong } from './om-protocol';

import { domainOptions } from './lib/utils/domains';
import { variableOptions } from './lib/utils/variables';
import { getIndicesFromBounds, getIndexFromLatLong } from './lib/utils/math';
import { OMapsFileReader } from './omaps-reader';
import { interpolateLinear } from './lib/utils/interpolations';
import { get } from 'svelte/store';
import LatLon from 'geodesy/latlon-spherical.js';
import { getColorScale } from '$lib/utils/color-scales';

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
	variableSelectionExtended,
	trajSettings
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
let trajRunning = false,
	stopTraj = false;

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
	if (!lvl || !(lvl.includes('hPa') || lvl.includes('10m'))) lvl = '10m';

	let variable = {
		value: 'wind_u_component_' + lvl,
		label
	};

	let bounds = [lat - 2, lng - 2, lat + 2, lng + 2];

	let boundsIndexes = getIndicesFromBounds(bounds[0], bounds[1], bounds[2], bounds[3], domain);
	let ranges = [
		{ start: boundsIndexes[1], end: boundsIndexes[3] },
		{ start: boundsIndexes[0], end: boundsIndexes[2] }
	];

	if (!myOmapsFileReader) {
		myOmapsFileReader = new OMapsFileReader(domain, true);
	}
	let t = Date.now();
	//log('Start', t);
	return new Promise((res, rej) => {
		setTimeout(() => {
			myOmapsFileReader.setReaderData(domain, true);
			myOmapsFileReader
				.init(url)
				.then(() => {
					return myOmapsFileReader.readVariable(variable, ranges).then((values) => {
						//log('Done', Date.now() - t);
						data.data = values;
						data.ranges = ranges;
						data.bounds = bounds;
						data.model = domain.label;
						data.time = new Date(timeStr.slice(0, -2) + ':00' + 'Z');
						dataCache.push(data);
						activeData = data;
						res(activeData);

						// prefetch first bytes of the previous and next timesteps to trigger CF caching  ??????? what does this do:
						//myOmapsFileReader.prefetch(omUrl);
					});
				})
				.catch((e) => {
					console.log(e);
				});
		}, 50);
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

function drawTraj(lat, lng, time, tries = 0) {
	if (trajRunning) {
		stopTraj = true;
		setTimeout(() => {
			if (tries < 10) drawTraj(lat, lng, time, tries + 1);
			else {
				trajRunning = false;
				stopTraj = false;
			}
		}, 500);

		return;
	}

	let outOfBounds = false;
	trajRunning = true;
	resetLines();
	if (Date.now() - lastTrajTime < 1000) return;
	lastTrajTime = Date.now();
	let startIx = floor(time / h1);
	let prevIx = startIx;
	let previ = 0;

	let samples = get(trajSettings).duration * 12;

	return new Promise((res, rej) => {
		let points = [new LatLon(lat, lng)];
		const nextPoint = (i, p, time) => {
			getData(p.lat, p.lng, time).then((data) => {
				let { speed, dir } = getSpeedAndDir(data, p.lat, p.lng);
				//log(speed, dir);
				let p2;
				if (isNaN(speed) || isNaN(dir)) {
					stopTraj = true;
					outOfBounds = true;
				} else {
					p2 = p.destinationPoint(speed * interval, dir);
					points.push(p2);

					let newTime = new Date(+time + interval * 1000);
					let newIx = floor(newTime / h1);
					if (newIx > prevIx || i == samples) {
						// if in the next hour,  change line style
						drawLine(points, prevIx - startIx, previ, i);
						document.querySelector('#traj-progress').innerHTML =
							`Progress: ${((100 * i) / samples).toFixed(0)}%`;
						prevIx = newIx;
						previ = i;
					}
				}
				if (i < samples && !stopTraj) {
					nextPoint(i + 1, p2, new Date(+time + interval * 1000));
				} else {
					let msg = stopTraj
						? outOfBounds
							? 'Out of Bounds'
							: 'Interrupted'
						: `Progress: ${((100 * i) / samples).toFixed(0)}%`;
					if (!stopTraj)
						setTimeout(
							() => (document.querySelector('#traj-progress').innerHTML = 'Progress:'),
							2000
						);
					stopTraj = false;
					trajRunning = false;
					res(points);
					document.querySelector('#traj-progress').innerHTML = msg;
				}
			});
		};

		nextPoint(0, points[0], time);
	}).then((points) => {
		//console.log('ALL DONE');
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
			let variable = get(variables)[0];
			let text = `
                Wind: ${speed.toFixed(1)}m/s <br>
                Dir: ${((dir + 180) % 360).toFixed(0)}
            `;
			if (!variable.value.includes('Wind')) {
				let colorScale = getColorScale(variable.value);
				let { value } = getValueFromLatLong(lat, lng, colorScale);
				text += '<br>' + value.toFixed(1) + colorScale.unit;
			}

			el.firstElementChild.innerHTML = text;
		});
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

export { addMarker, removeMarker, initTrajModule, drawTraj };
