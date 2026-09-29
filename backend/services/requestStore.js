const fs = require("fs");
const path = require("path");

const dataDirectory = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDirectory, "requests.json");

function ensureDataFile() {
	if (!fs.existsSync(dataDirectory)) {
		fs.mkdirSync(dataDirectory, { recursive: true });
	}

	if (!fs.existsSync(dataFile)) {
		fs.writeFileSync(dataFile, "[]", "utf8");
	}
}

function getRequests() {
	ensureDataFile();

	const fileContent = fs.readFileSync(dataFile, "utf8");

	try {
		return JSON.parse(fileContent);
	} catch {
		return [];
	}
}

function saveRequest(request) {
	const requests = getRequests();

	const newRequest = {
		id: Date.now().toString(),
		...request,
		createdAt: new Date().toISOString(),
	};

	requests.push(newRequest);

	fs.writeFileSync(
		dataFile,
		JSON.stringify(requests, null, 2),
		"utf8"
	);

	return newRequest;
}

async function backfillCoordinates(getCoordinates) {
	const requests = getRequests();
	const locationCache = {};
	let updatedCount = 0;

	for (const request of requests) {
		if (request.coordinates || !request.location) {
			continue;
		}

		const locationKey = request.location.trim().toLowerCase();

		if (!locationCache[locationKey]) {
			try {
				locationCache[locationKey] =
					await getCoordinates(request.location);

				// Respect Nominatim's public usage rate.
				await new Promise((resolve) =>
					setTimeout(resolve, 1100)
				);
			} catch (error) {
				console.error(
					`Could not geocode ${request.location}:`,
					error.message
				);

				locationCache[locationKey] = null;
			}
		}

		if (locationCache[locationKey]) {
			request.coordinates = locationCache[locationKey];
			updatedCount += 1;
		}
	}

	fs.writeFileSync(
		dataFile,
		JSON.stringify(requests, null, 2),
		"utf8"
	);

	return updatedCount;
}

module.exports = {
	getRequests,
	saveRequest,
	backfillCoordinates,
};