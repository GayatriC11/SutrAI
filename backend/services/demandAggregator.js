function normalizeText(text = "") {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeLocation(location = "") {
    return location
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/*
 * AI is responsible for identifying the development need.
 * This file contains no location-specific exceptions
 * or hard-coded test cases.
 */
function identifyDemandGroup(request) {
    const text = normalizeText(
        `${request.request || ""} ${
            request.analysis?.developmentNeed || ""
        } ${request.analysis?.category || ""}`
    );

    /*
     * Use the AI-generated category/development need
     * as the primary demand group.
     */
    if (request.analysis?.category) {
        return request.analysis.category.trim();
    }

    if (request.analysis?.developmentNeed) {
        return request.analysis.developmentNeed.trim();
    }

    /*
     * Fallback only when AI did not return either field.
     */
    if (!text) {
        return "Other Development Need";
    }

    return "Other Development Need";
}

/*
 * Create a stable geographic key from coordinates.
 *
 * Coordinates are preferred over the typed location name.
 * This prevents:
 *
 * "Nandur Pathar"
 * "Nandur Pathar, Ahilyanagar"
 *
 * from becoming separate geographic areas when they
 * actually point to the same place.
 */
function getLocationKey(request) {
    const coordinates = request.coordinates;

    if (
        coordinates &&
        Number.isFinite(Number(coordinates.latitude)) &&
        Number.isFinite(Number(coordinates.longitude))
    ) {
        /*
         * Round only for grouping purposes.
         * This avoids tiny floating-point differences while
         * keeping genuinely different locations separate.
         */
        const latitude = Number(coordinates.latitude).toFixed(4);
        const longitude = Number(coordinates.longitude).toFixed(4);

        return `coordinates:${latitude},${longitude}`;
    }

    /*
     * If coordinates are unavailable, fall back to the
     * normalized location text.
     */
    return `location:${normalizeText(
        request.location || "Unknown"
    )}`;
}

function aggregateDemands(requests) {
    const groups = {};

    for (const request of requests) {
        const location = normalizeLocation(
            request.location || "Unknown"
        );

        const demandGroup =
            request.demandGroup ||
            identifyDemandGroup(request);

        /*
         * Coordinates are the primary geographic identity.
         * Demand group is still kept separate.
         */
        const locationKey = getLocationKey(request);
        const demandKey = normalizeText(demandGroup);

        const key = `${locationKey}|||${demandKey}`;

        if (!groups[key]) {
            groups[key] = {
                location,
                demandGroup,
                coordinates: request.coordinates || null,
                requestCount: 0,
                requests: [],
            };
        }

        /*
         * Keep coordinates from the first request unless
         * the group does not have coordinates yet.
         */
        if (
            !groups[key].coordinates &&
            request.coordinates
        ) {
            groups[key].coordinates = request.coordinates;
        }

        /*
         * Prefer the more descriptive location name when
         * the first request has a shorter version.
         */
        if (
            request.location &&
            request.location.length > groups[key].location.length
        ) {
            groups[key].location = location;
        }

        groups[key].requestCount += 1;

        groups[key].requests.push({
            id: request.id,
            request: request.request,
            createdAt: request.createdAt,
        });
    }

    return Object.values(groups).sort(
        (a, b) => b.requestCount - a.requestCount
    );
}

module.exports = {
    identifyDemandGroup,
    aggregateDemands,
};