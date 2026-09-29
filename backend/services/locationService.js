const NOMINATIM_URL =
	"https://nominatim.openstreetmap.org/search";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocode(query) {
	const controller = new AbortController();

	const timeout = setTimeout(() => {
		controller.abort();
	}, 10000);

	try {
		const url = new URL(NOMINATIM_URL);

		url.searchParams.set("q", query);
		url.searchParams.set("format", "json");
		url.searchParams.set("limit", "5");
		url.searchParams.set("addressdetails", "1");

		const response = await fetch(url, {
			headers: {
				"User-Agent": "SutrAI-Hackathon-Demo/1.0",
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(
				`Nominatim request failed: ${response.status}`
			);
		}

		return await response.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function getLocationCoordinates(location) {
	if (!location || !location.trim()) {
		return null;
	}

	const original = location.trim();

	const parts = original
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

	const area = parts[0] || original;
	const city = parts[1] || "";

	const queries = [
		original,
		`${area}, ${city}, Maharashtra, India`,
		`${area}, ${city}, India`,
		`${original}, Maharashtra, India`,
		`${original}, India`,
	];

	for (const query of queries) {
		try {
			console.log(`Trying location search: ${query}`);

			const results = await geocode(query);

			if (!Array.isArray(results) || results.length === 0) {
				await sleep(1100);
				continue;
			}

			const normalizedArea = area
				.toLowerCase()
				.replace(/\s+/g, " ")
				.trim();

			const normalizedCity = city.toLowerCase().trim();

			const scoredResults = results.map((result) => {
				const displayName = (
					result.display_name || ""
				).toLowerCase();

				const addressText = Object.values(
					result.address || {}
				)
					.join(" ")
					.toLowerCase();

				const combinedText =
					`${displayName} ${addressText}`;

				let score = 0;

				if (combinedText.includes(normalizedArea)) {
					score += 100;
				}

				if (
					normalizedCity &&
					combinedText.includes(normalizedCity)
				) {
					score += 30;
				}

				if (
					[
						"suburb",
						"neighbourhood",
						"locality",
						"village",
						"town",
					].includes(result.type)
				) {
					score += 20;
				}

				return {
					result,
					score,
				};
			});

			scoredResults.sort(
				(a, b) => b.score - a.score
			);

			const best = scoredResults[0];

			if (!best || best.score < 100) {
				console.warn(
					`No reliable match found for "${original}" using "${query}".`
				);

				await sleep(1100);
				continue;
			}

			const result = best.result;

			const latitude = Number(result.lat);
			const longitude = Number(result.lon);

			if (
				Number.isFinite(latitude) &&
				Number.isFinite(longitude)
			) {
				console.log(
					`Location resolved: ${original} → ${result.display_name}`
				);

				return {
					latitude,
					longitude,
					displayName:
						result.display_name || query,
				};
			}
		} catch (error) {
			console.error(
				`Location search failed for "${query}":`,
				error.message
			);
		}

		await sleep(1100);
	}

	console.warn(
		`Could not reliably resolve location: ${original}`
	);

	return null;
}

async function getUserLocation() {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(
				new Error(
					"Geolocation is not supported by this browser."
				)
			);
			return;
		}

		navigator.geolocation.getCurrentPosition(
			(position) => {
				resolve({
					latitude: position.coords.latitude,
					longitude: position.coords.longitude,
				});
			},
			(error) => {
				reject(error);
			}
		);
	});
}

module.exports = {
	getLocationCoordinates,
	getUserLocation,
};