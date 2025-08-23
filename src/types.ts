export type TileJSON = {
	tilejson: '2.2.0';
	tiles: Array<string>;
	name?: string;
	description?: string;
	version?: string;
	attribution?: string;
	template?: string;
	legend?: string;
	scheme?: string;
	grids?: Array<string>;
	data?: Array<string>;
	minzoom: number;
	maxzoom: number;
	bounds?: Array<number>;
	center?: Array<number>;
};

export type TileIndex = {
	z: number;
	x: number;
	y: number;
};

export type Bbox = [number, number, number, number];

export type Location = {
	latitude: number;
	longitude: number;
};

export type LatLonZoom = {
	latitude: number;
	longitude: number;
	zoom: number;
};

export type TilePixel = {
	tileIndex: TileIndex;
	row: number;
	column: number;
};

export type Variable = {
	value: string;
	label: string;
};

export type ColorScale = {
	min: number;
	max: number;
	scalefactor: number;
	colors: number[][];
	interpolationMethod: InterpolationMethod;
};

export type InterpolationMethod = 'hermite2d' | 'quintic2d';

export type Interpolator = (
	values: Float32Array<ArrayBufferLike>,
	nx: number,
	index: number,
	xFraction: number,
	yFraction: number
) => number;

export interface Domain {
	value: string;
	label: string;
	grid: {
		nx: number;
		ny: number;
		lonMin: number;
		latMin: number;
		dx: number;
		dy: number;
		zoom?: number;
		projection?: {
			name: string;
			λ0?: number;
			ϕ0?: number;
			ϕ1?: number;
			ϕ2?: number;
			rotation?: number[];
			radius?: number;
			latitude?: number[] | number;
			longitude?: number[] | number;
			bounds?: number[];
			projectOrigin?: boolean;
		};
		center?:
			| {
					lng: number;
					lat: number;
			  }
			| Function;
	};
	time_interval: number;
	model_interval: number;
	variables: string[];
	windUVComponents: boolean;
}

export interface DomainGroups {
	[key: string]: Domain[];
}

export type Bounds = [
	minimumLongitude: number,
	minimumLatitude: number,
	maximumLongitude: number,
	maximumLatitude: number
];

export interface Center {
	lng: number;
	lat: number;
}

export interface IndexAndFractions {
	index: number;
	xFraction: number;
	yFraction: number;
}

export interface Range {
	start: number;
	end: number;
}
