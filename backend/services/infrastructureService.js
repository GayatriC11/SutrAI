const OVERPASS_ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const CACHE_DURATION = 5 * 60 * 1000;
const RADIUS_METERS = 5000;

const getGovernmentHospitals = require("./governmentHospitalService");

const infrastructureCache = new Map();

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   OPENSTREETMAP / OVERPASS
========================================================= */

async function requestOverpass(endpoint, query) {
    const controller = new AbortController();

    // Give the server enough time to answer,
    // but don't let one endpoint block the whole app.
    const timeout = setTimeout(() => {
        controller.abort();
    }, 20000);

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "SutrAI-Hackathon-Demo/1.0",
            },
            body: new URLSearchParams({
                data: query,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const error = new Error(
                `Overpass request failed: ${response.status}`
            );
            error.status = response.status;
            throw error;
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

async function tryOverpass(query) {
    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
        const endpoint = OVERPASS_ENDPOINTS[i];

        try {
            console.log(
                `Trying Overpass endpoint ${i + 1}/${OVERPASS_ENDPOINTS.length}`
            );

            const data = await requestOverpass(endpoint, query);

            console.log("Overpass request succeeded.");

            return data;
        } catch (error) {
            console.error("Overpass endpoint failed:", {
                endpoint,
                name: error.name,
                message: error.message,
                status: error.status,
            });

            if (error.name === "AbortError") {
                console.log("Overpass request timed out.");
            }

            // Small pause before trying another public server.
            await sleep(800);
        }
    }

    console.warn("All Overpass endpoints failed.");

    return null;
}

/* =========================================================
   EXTRACT INFRASTRUCTURE
========================================================= */

function extractOverpassPlaces(data) {
    const counts = {
        healthcare: 0,
        education: 0,
        transport: 0,
    };

    const places = [];

    for (const element of data?.elements || []) {
        const tags = element.tags || {};

        let type = null;

        /* =====================================================
           HEALTHCARE
        ===================================================== */

        if (
            tags.amenity === "hospital" ||
            tags.amenity === "clinic"
        ) {
            type = "healthcare";
        }

        /* =====================================================
           EDUCATION
        ===================================================== */

        else if (
            tags.amenity === "school" ||
            tags.amenity === "college"
        ) {
            type = "education";
        }

        /* =====================================================
           TRANSPORT
        ===================================================== */

        else if (
            tags.highway === "bus_stop" ||
            tags.amenity === "bus_station" ||
            tags.amenity === "taxi" ||
            tags.railway === "station" ||
            tags.railway === "halt" ||
            tags.railway === "subway" ||
            tags.public_transport === "station" ||
            tags.public_transport === "stop_position"
        ) {
            type = "transport";
        }

        if (!type) {
            continue;
        }

        counts[type] += 1;

        let subtype = "Facility";

        if (tags.amenity === "hospital") {
            subtype = "Hospital";
        } else if (tags.amenity === "clinic") {
            subtype = "Clinic";
        } else if (tags.amenity === "school") {
            subtype = "School";
        } else if (tags.amenity === "college") {
            subtype = "College";
        } else if (tags.highway === "bus_stop") {
            subtype = "Bus Stop";
        } else if (tags.amenity === "bus_station") {
            subtype = "Bus Station";
        } else if (tags.amenity === "taxi") {
            subtype = "Taxi / Auto Stand";
        } else if (tags.railway === "station") {
            subtype = "Railway Station";
        } else if (tags.railway === "halt") {
            subtype = "Railway Halt";
        } else if (tags.railway === "subway") {
            subtype = "Metro / Subway";
        } else if (tags.public_transport === "station") {
            subtype = "Public Transport Station";
        } else if (tags.public_transport === "stop_position") {
            subtype = "Transport Stop";
        }

        places.push({
            name: tags.name || null,
            type,
            subtype,
            nameAvailable: Boolean(tags.name),
            source: "OpenStreetMap",
        });
    }

    return {
        counts,
        places,
    };
}

/* =========================================================
   MAIN INFRASTRUCTURE FUNCTION
========================================================= */

async function getInfrastructure(latitude, longitude) {
    const cacheKey = `${Number(latitude).toFixed(4)},${Number(
        longitude
    ).toFixed(4)}`;

    /* =====================================================
       CACHE
    ===================================================== */

    const cached = infrastructureCache.get(cacheKey);

    if (
        cached &&
        Date.now() - cached.timestamp < CACHE_DURATION
    ) {
        console.log(
            "Using cached infrastructure data for",
            cacheKey
        );

        return cached.data;
    }

    const radius = RADIUS_METERS;

/* ONE QUERY */

    const overpassQuery = `
[out:json][timeout:30];
(
    nwr[
        "amenity"~"hospital|clinic|school|college"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "highway"="bus_stop"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "amenity"="bus_station"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "amenity"="taxi"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "railway"="station"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "railway"="halt"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "railway"="subway"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "public_transport"="station"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );

    nwr[
        "public_transport"="stop_position"
    ](
        around:${radius},
        ${latitude},
        ${longitude}
    );
);

out center tags;
`;

    console.log(
        `Searching infrastructure within ${radius / 1000} km...`
    );

/* STEP 1 — OPENSTREETMAP */

    const osmData = await tryOverpass(overpassQuery);

    let places = [];

    let counts = {
        healthcare: 0,
        education: 0,
        transport: 0,
    };

    let infrastructureSource = "OpenStreetMap";
    let dataStatus = "complete";

    if (osmData) {
        const extracted = extractOverpassPlaces(osmData);

        places = extracted.places;
        counts = extracted.counts;

        console.log(
            `OpenStreetMap returned ${places.length} facilities.`
        );

        console.log("Infrastructure counts:", counts);
    } else {
        // Do NOT pretend that zero facilities exist.

        infrastructureSource =
            "OpenStreetMap - data unavailable";

        dataStatus = "osm_unavailable";

        console.warn(
            "OpenStreetMap infrastructure data unavailable."
        );
    }

/* STEP 2 — GOVERNMENT HOSPITAL DATASET */

    let governmentHospitals = {
        count: 0,
        places: [],
        source:
            "National Hospital Directory - data.gov.in",
    };

    try {
        const hospitals = getGovernmentHospitals(
            latitude,
            longitude,
            radius / 1000
        );

        governmentHospitals = {
            count: hospitals.length,
            places: hospitals,
            source:
                "National Hospital Directory - data.gov.in",
        };

        console.log(
            `Government hospitals found: ${hospitals.length}`
        );
    } catch (error) {
        console.error(
            "Government hospital dataset lookup failed:",
            error.message
        );
    }

    /* FINAL RESULT */

    const result = {
        radius,

        // null means we could not verify the infrastructure.
        counts:
            dataStatus === "osm_unavailable"
                ? null
                : counts,

        totalFacilities:
            dataStatus === "osm_unavailable"
                ? null
                : places.length,

        places:
            dataStatus === "osm_unavailable"
                ? []
                : places,

        source: infrastructureSource,
        dataStatus,
        governmentHospitals,
    };

/* SAVE TO CACHE */

    infrastructureCache.set(cacheKey, {
        timestamp: Date.now(),
        data: result,
    });

    return result;
}

/* EXPORT */

module.exports = {
    getInfrastructure,
};