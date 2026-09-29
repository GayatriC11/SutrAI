const fs = require('fs');
const path = require('path');

const HOSPITALS_CSV_PATH = path.join(__dirname, '..', 'data', 'hospitals.csv');
let hospitalCache = null;

function parseCsv(text) {
	const rows = [];
	let currentRow = [];
	let currentValue = '';
	let inQuotes = false;

	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		const nextChar = text[i + 1];

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				currentValue += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (char === ',' && !inQuotes) {
			currentRow.push(currentValue);
			currentValue = '';
			continue;
		}

		if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && nextChar === '\n') {
				i += 1;
			}

			currentRow.push(currentValue);
			const trimmedRow = currentRow.map((field) => field.trim());

			if (trimmedRow.some((field) => field !== '')) {
				rows.push(trimmedRow);
			}

			currentRow = [];
			currentValue = '';
			continue;
		}

		currentValue += char;
	}

	if (currentValue !== '' || currentRow.length) {
		currentRow.push(currentValue);
		const trimmedRow = currentRow.map((field) => field.trim());
		if (trimmedRow.some((field) => field !== '')) {
			rows.push(trimmedRow);
		}
	}

	return rows;
}

function parseNumber(value) {
	if (value === undefined || value === null) {
		return null;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
	if (value === undefined || value === null) {
		return '';
	}

	return String(value).trim();
}

function parseCoordinates(locationCoordinates) {
	const text = normalizeText(locationCoordinates);
	if (!text) {
		return null;
	}

	const matches = text.match(/-?\d+(?:\.\d+)?/g);
	if (!matches || matches.length < 2) {
		return null;
	}

	const latitude = Number(matches[0]);
	const longitude = Number(matches[1]);

	if (
		!Number.isFinite(latitude) ||
		!Number.isFinite(longitude) ||
		latitude < -90 ||
		latitude > 90 ||
		longitude < -180 ||
		longitude > 180
	) {
		return null;
	}

	return {
		latitude,
		longitude,
	};
}

function loadHospitals() {
	if (hospitalCache) {
		return hospitalCache;
	}

	if (!fs.existsSync(HOSPITALS_CSV_PATH)) {
		throw new Error(`Hospitals CSV not found at ${HOSPITALS_CSV_PATH}`);
	}

	const csvText = fs.readFileSync(HOSPITALS_CSV_PATH, 'utf8');
	const parsedRows = parseCsv(csvText);

	if (parsedRows.length < 2) {
		hospitalCache = [];
		return hospitalCache;
	}

	const headers = parsedRows[0].map((header) => normalizeText(header));
	const records = [];

	for (let rowIndex = 1; rowIndex < parsedRows.length; rowIndex += 1) {
		const values = parsedRows[rowIndex];
		const record = {};

		headers.forEach((header, index) => {
			record[header] = values[index] !== undefined ? values[index] : '';
		});

		const coordinates = parseCoordinates(record.Location_Coordinates);
		if (!coordinates) {
			continue;
		}

		const category = normalizeText(record.Hospital_Category);
		const isGovernmentHospital = category
			.toLowerCase()
			.includes('government') ||
			category.toLowerCase().includes('govt') ||
			category.toLowerCase().includes('public');

		if (!isGovernmentHospital) {
			continue;
		}

		records.push({
			hospitalName: normalizeText(record.Hospital_Name) || 'Unknown Hospital',
			category,
			state: normalizeText(record.State),
			district: normalizeText(record.District),
			subdistrict: normalizeText(record.Subdistrict),
			address:
				normalizeText(record.Address_Original_First_Line) ||
				normalizeText(record.Location) ||
				'',
			coordinates,
			totalBeds: parseNumber(record.Total_Num_Beds),
			emergencyServices: normalizeText(record.Emergency_Services),
			telephone: normalizeText(record.Telephone),
			mobileNumber: normalizeText(record.Mobile_Number),
			website: normalizeText(record.Website),
			facilityDetails: normalizeText(record.Facilities),
		});
	}

	hospitalCache = records;
	return hospitalCache;
}
function calculateDistanceKm(latitude1, longitude1, latitude2, longitude2) {
	const toRadians = (degrees) => (degrees * Math.PI) / 180;
	const earthRadiusKm = 6371;
	const dLat = toRadians(latitude2 - latitude1);
	const dLon = toRadians(longitude2 - longitude1);
	const lat1 = toRadians(latitude1);
	const lat2 = toRadians(latitude2);

	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1) *
			Math.cos(lat2) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);

	const clampedA = Math.min(Math.max(a, 0), 1);
	const c =
		2 *
		Math.atan2(
			Math.sqrt(clampedA),
			Math.sqrt(Math.max(0, 1 - clampedA))
		);
	return earthRadiusKm * c;
}

function getGovernmentHospitals(latitude, longitude, radiusKm) {
	if (
		!Number.isFinite(Number(latitude)) ||
		!Number.isFinite(Number(longitude)) ||
		!Number.isFinite(Number(radiusKm)) ||
		Number(radiusKm) <= 0
	) {
		return [];
	}

	const lat = Number(latitude);
	const lon = Number(longitude);
	const radius = Number(radiusKm);

	const hospitals = loadHospitals();

	return hospitals
		.map((hospital) => {
			const rawDistanceKm = calculateDistanceKm(
				lat,
				lon,
				hospital.coordinates.latitude,
				hospital.coordinates.longitude
			);

			if (!Number.isFinite(rawDistanceKm)) {
				return null;
			}

			return {
				...hospital,
				distanceKm: Number(rawDistanceKm.toFixed(2)),
				_rawDistanceKm: rawDistanceKm,
			};
		})
		.filter((hospital) => hospital && hospital._rawDistanceKm <= radius)
		.sort((a, b) => a._rawDistanceKm - b._rawDistanceKm)
		.map(({ _rawDistanceKm, ...hospital }) => hospital);
}

module.exports = getGovernmentHospitals;
