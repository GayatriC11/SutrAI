const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");

const {
	getRequests,
	saveRequest,
	backfillCoordinates,
} = require("./services/requestStore");

const {
	aggregateDemands,
	identifyDemandGroup,
} = require("./services/demandAggregator");

const { generatePriorityData } = require("./services/priorityEngine");

const { getInfrastructure } = require("./services/infrastructureService");

const getGovernmentHospitals = require("./services/governmentHospitalService");

const { getLocationCoordinates } = require("./services/locationService");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "50kb" }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = GEMINI_API_KEY
	? new GoogleGenAI({
			apiKey: GEMINI_API_KEY,
		})
	: null;

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGeminiStatus(error) {
	return (
		error?.status ||
		error?.statusCode ||
		error?.code ||
		error?.response?.status ||
		null
	);
}

function getErrorMessage(error) {
	return (
		error?.message ||
		error?.response?.data?.error?.message ||
		"Unknown error"
	);
}

function isGeminiQuotaError(error) {
	const status = getGeminiStatus(error);
	const message = getErrorMessage(error).toLowerCase();

	return (
		status === 429 ||
		status === "RESOURCE_EXHAUSTED" ||
		message.includes("resource_exhausted") ||
		message.includes("quota") ||
		message.includes("rate limit") ||
		message.includes("too many requests")
	);
}

function isGeminiRetryableError(error) {
	const status = getGeminiStatus(error);

	return (
		status === 408 ||
		status === 429 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504
	);
}

/* =========================================================
   GEMINI
   ========================================================= */

async function generateGeminiResponse(prompt) {
	if (!ai) {
		throw new Error("GEMINI_API_KEY is not configured.");
	}

	const models = [
		"gemini-3.6-flash",
		"gemini-3.5-flash-lite",
	];

	let lastError = null;

	for (const model of models) {
		for (let attempt = 1; attempt <= 1; attempt++) {
			try {
				console.log(
					`Trying Gemini model: ${model} | attempt ${attempt}/2`
				);

				const response = await ai.models.generateContent({
					model,
					contents: prompt,
				});

				console.log(
					`Gemini request succeeded using ${model}.`
				);

				return {
					response,
					model,
				};
			} catch (error) {
				lastError = error;

				const status = getGeminiStatus(error);

				console.error(
					`Gemini ${model} failed | status: ${
						status || "unknown"
					} | message: ${getErrorMessage(error)}`
				);

				/*
				 * IMPORTANT:
				 * A quota error should immediately leave Gemini
				 * and activate the local fallback.
				 */
				if (isGeminiQuotaError(error)) {
					throw error;
				}

				if (!isGeminiRetryableError(error)) {
					break;
				}

				if (attempt < 2) {
					const delay = attempt * 2000;

					console.log(
						`Retrying ${model} in ${
							delay / 1000
						} seconds...`
					);

					await sleep(delay);
				}
			}
		}

		console.log(
			`Moving to next Gemini model after failures: ${model}`
		);
	}

	throw (
		lastError ||
		new Error("Gemini request failed.")
	);
}

function extractGeminiText(response) {
	if (!response) {
		return "";
	}

	if (typeof response.text === "string") {
		return response.text.trim();
	}

	if (typeof response.text === "function") {
		try {
			return response.text().trim();
		} catch {
			// Continue to other response formats.
		}
	}

	const candidateText =
		response?.candidates?.[0]?.content?.parts
			?.map((part) => part.text || "")
			.join("")
			.trim();

	return candidateText || "";
}

function cleanJsonText(text) {
	if (!text) {
		return "";
	}

	return text
		.trim()
		.replace(/^```json\s*/i, "")
		.replace(/^```\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
}

function parseGeminiJson(text) {
	const cleaned = cleanJsonText(text);

	if (!cleaned) {
		return null;
	}

	try {
		return JSON.parse(cleaned);
	} catch {
		/*
		 * Sometimes Gemini adds a little text before/after JSON.
		 * Try to recover the main JSON object.
		 */
		const firstBrace = cleaned.indexOf("{");
		const lastBrace = cleaned.lastIndexOf("}");

		if (firstBrace !== -1 && lastBrace > firstBrace) {
			try {
				return JSON.parse(
					cleaned.slice(firstBrace, lastBrace + 1)
				);
			} catch {
				return null;
			}
		}

		return null;
	}
}

/* =========================================================
   LOCAL CITIZEN ANALYSIS FALLBACK
   ========================================================= */

function normalizeText(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function detectLocalCategory(request, selectedCategory) {
	if (
		selectedCategory &&
		selectedCategory !== "Auto-detect"
	) {
		return selectedCategory;
	}

	const text = normalizeText(request);

	const rules = [
		{
			category: "Healthcare",
			keywords: [
				"hospital",
				"clinic",
				"doctor",
				"medical",
				"health",
				"ambulance",
				"medicine",
				"healthcare",
			],
		},
		{
			category: "Education",
			keywords: [
				"school",
				"college",
				"teacher",
				"education",
				"classroom",
				"students",
			],
		},
		{
			category: "Water",
			keywords: [
				"water",
				"pipeline",
				"tap",
				"drinking water",
				"shortage",
				"leakage",
			],
		},
		{
			category: "Roads & Connectivity",
			keywords: [
				"road",
				"roads",
				"pothole",
				"bridge",
				"street",
				"connectivity",
				"traffic",
			],
		},
		{
			category: "Public Transport",
			keywords: [
				"bus",
				"buses",
				"transport",
				"bus stop",
				"railway",
				"train",
				"metro",
			],
		},
		{
			category: "Waste Management",
			keywords: [
				"garbage",
				"waste",
				"trash",
				"dump",
				"cleanliness",
				"sanitation",
			],
		},
		{
			category: "Electricity",
			keywords: [
				"electricity",
				"power",
				"electric",
				"transformer",
				"street light",
				"blackout",
			],
		},
	];

	for (const rule of rules) {
		if (
			rule.keywords.some((keyword) =>
				text.includes(keyword)
			)
		) {
			return rule.category;
		}
	}

	return "Other";
}

function detectLocalDevelopmentNeed(category, request) {
	const text = normalizeText(request);

	const needs = {
		"Healthcare":
			"Healthcare Infrastructure",
		"Education":
			"Education Infrastructure",
		"Roads & Connectivity":
			"Roads & Connectivity",
		"Public Transport":
			"Public Transportation",
		"Water":
			"Water Supply Infrastructure",
		"Waste Management":
			"Waste Management",
		"Electricity":
			"Electricity Infrastructure",
		"Other":
			"Public Infrastructure",
	};

	if (category === "Healthcare") {
		if (
			text.includes("hospital") ||
			text.includes("clinic")
		) {
			return "Healthcare Infrastructure";
		}

		return "Healthcare Services";
	}

	return needs[category] || "Public Infrastructure";
}

function detectLocalUrgency(request) {
	const text = normalizeText(request);

	const highWords = [
		"emergency",
		"urgent",
		"critical",
		"danger",
		"unsafe",
		"accident",
		"life threatening",
		"immediately",
	];

	const mediumWords = [
		"shortage",
		"limited",
		"poor",
		"lack",
		"insufficient",
		"frequent",
		"problem",
		"issue",
	];

	if (
		highWords.some((word) =>
			text.includes(word)
		)
	) {
		return "High";
	}

	if (
		mediumWords.some((word) =>
			text.includes(word)
		)
	) {
		return "Medium";
	}

	return "Low";
}

function createLocalCitizenAnalysis({
	request,
	location,
	area,
	language,
	category,
}) {
	const detectedCategory = detectLocalCategory(
		request,
		category
	);

	const developmentNeed =
		detectLocalDevelopmentNeed(
			detectedCategory,
			request
		);

	const urgency = detectLocalUrgency(request);

	return {
		category: detectedCategory,
		developmentNeed,
		urgency,
		affectedArea: `${area}, ${location}`,
		summary: `The request indicates a local need related to ${developmentNeed.toLowerCase()} in ${area}, ${location}. The signal has been structured from the citizen's description for inclusion in SutrAI's development-demand analysis.`,
		reasoning: `The submitted request contains indicators associated with ${detectedCategory.toLowerCase()}. This local fallback analysis is being used because the external AI service is temporarily unavailable. It should be treated as a structured demand signal rather than a final infrastructure assessment.`,
		language: language || "English",
		analysisSource: "Local fallback",
	};
}

/* =========================================================
   LOCAL RECOMMENDATION FALLBACK
   ========================================================= */

function getLocalPriority(requestCount, infrastructureCount) {
	if (
		infrastructureCount !== null &&
		infrastructureCount === 0 &&
		requestCount >= 2
	) {
		return "High";
	}

	if (requestCount >= 4) {
		return "High";
	}

	if (requestCount >= 2) {
		return "Medium";
	}

	return "Low";
}

function getInfrastructureLabel(developmentArea) {
	const text = normalizeText(developmentArea);

	if (
		text.includes("healthcare") ||
		text.includes("health")
	) {
		return "healthcare facilities";
	}

	if (text.includes("education")) {
		return "education facilities";
	}

	if (
		text.includes("transport") ||
		text.includes("road") ||
		text.includes("connectivity")
	) {
		return "mapped transport points";
	}

	if (text.includes("water")) {
		return "mapped water-related infrastructure";
	}

	if (
		text.includes("waste") ||
		text.includes("sanitation")
	) {
		return "mapped waste-related facilities";
	}

	if (text.includes("electricity")) {
		return "mapped electricity-related infrastructure";
	}

	return "mapped facilities";
}

function createLocalRecommendation(
	cluster,
	infrastructure
) {
	const requestCount =
		Number(cluster.requestCount) || 0;

	const infrastructureCount =
		infrastructure?.counts
			? getInfrastructureCountForDemand(
					cluster.demandGroup,
					infrastructure.counts
			  )
			: null;

	const priority = getLocalPriority(
		requestCount,
		infrastructureCount
	);

	const developmentArea =
		cluster.demandGroup ||
		"Public Infrastructure";

	let reason;

	if (
		infrastructureCount === 0 &&
		requestCount >= 2
	) {
		reason = `SutrAI has ${requestCount} recurring citizen demand signals for ${developmentArea.toLowerCase()}, while no matching mapped facilities were found within the 5 km analysis area. This creates a potential infrastructure gap that should be investigated.`;
	} else if (
		infrastructureCount !== null
	) {
		reason = `SutrAI found ${requestCount} citizen demand signal${
			requestCount === 1 ? "" : "s"
		} for ${developmentArea.toLowerCase()} and ${infrastructureCount} mapped ${getInfrastructureLabel(
			developmentArea
		)} within 5 km. The signal should be investigated alongside accessibility, capacity, distribution and service quality.`;
	} else {
		reason = `SutrAI has identified ${requestCount} citizen demand signal${
			requestCount === 1 ? "" : "s"
		} for ${developmentArea.toLowerCase()}. Infrastructure evidence is currently unavailable, so further investigation is recommended before making a development decision.`;
	}

	let suggestedAction;

	if (
		infrastructureCount === 0 &&
		requestCount >= 2
	) {
		suggestedAction =
			"Conduct a local verification of the identified gap and assess whether additional infrastructure or service capacity is required.";
	} else if (infrastructureCount > 0) {
		suggestedAction =
			"Review accessibility, capacity, distribution and service quality of existing facilities before considering new infrastructure.";
	} else {
		suggestedAction =
			"Verify the demand locally and collect additional infrastructure evidence before planning an intervention.";
	}

	return {
		location: cluster.location,
		developmentArea,
		requestCount,
		priority,
		reason,
		suggestedAction,
		coordinates: cluster.coordinates || null,
		infrastructureEvidence: buildInfrastructureEvidence(
			infrastructure,
			developmentArea
		),
		analysisSource: "Local fallback",
	};
}

function getInfrastructureCountForDemand(
	developmentArea,
	counts
) {
	const text = normalizeText(developmentArea);

	if (
		text.includes("healthcare") ||
		text.includes("health")
	) {
		return counts.healthcare ?? null;
	}

	if (text.includes("education")) {
		return counts.education ?? null;
	}

	if (
		text.includes("transport") ||
		text.includes("road") ||
		text.includes("connectivity")
	) {
		return counts.transport ?? null;
	}

	return null;
}

function buildInfrastructureEvidence(
	infrastructure,
	developmentArea
) {
	if (!infrastructure) {
		return {
			count: null,
			label: getInfrastructureLabel(
				developmentArea
			),
			radius: 5000,
			source: "Infrastructure data unavailable",
			dataStatus: "unavailable",
		};
	}

	const count =
		getInfrastructureCountForDemand(
			developmentArea,
			infrastructure.counts || {}
		);

	return {
		count,
		label: getInfrastructureLabel(
			developmentArea
		),
		radius: infrastructure.radius || 5000,
		source:
			infrastructure.source ||
			"OpenStreetMap",
		dataStatus:
			infrastructure.dataStatus ||
			"complete",
	};
}

/* =========================================================
   QUOTA RESPONSE
   ========================================================= */

function sendGeminiQuotaResponse(res) {
	return res.status(200).json({
		success: true,
		fallback: true,
		analysisSource: "Local fallback",
		message:
			"Gemini is temporarily unavailable. SutrAI used its local fallback analysis.",
	});
}

/* =========================================================
   ROOT
   ========================================================= */

app.get("/", (req, res) => {
	res.json({
		success: true,
		message: "SutrAI backend is running!",
	});
});

/* =========================================================
   CITIZEN REQUEST + AI ANALYSIS
   ========================================================= */

app.post("/api/analyze-request", async (req, res) => {
	try {
		const {
			request,
			location,
			area,
			language,
			category,
		} = req.body;

		if (
			!request ||
			!request.trim() ||
			!location ||
			!location.trim() ||
			!area ||
			!area.trim()
		) {
			return res.status(400).json({
				success: false,
				message:
					"Request, city/town and area/locality are required.",
			});
		}

		if (request.length > 5000) {
			return res.status(400).json({
				success: false,
				message:
					"Please keep the request below 5000 characters.",
			});
		}

		const specificLocation =
			`${area.trim()}, ${location.trim()}`;

		/*
		 * -----------------------------------------------------
		 * STEP 1: GEOCODE FIRST
		 * -----------------------------------------------------
		 */

		let coordinates = null;

		try {
			coordinates =
				await getLocationCoordinates(
					specificLocation
				);
		} catch (error) {
			console.error(
				"Geocoding failed:",
				getErrorMessage(error)
			);
		}

		if (!coordinates) {
			return res.status(404).json({
				success: false,
				message: `Could not find the specific area "${specificLocation}". Please check the city/town and area/locality names.`,
			});
		}

		const latitude =
			coordinates.latitude ??
			coordinates.lat;

		const longitude =
			coordinates.longitude ??
			coordinates.lon;

		if (
			typeof latitude !== "number" ||
			typeof longitude !== "number"
		) {
			return res.status(404).json({
				success: false,
				message:
					"Could not determine coordinates for this area.",
			});
		}

		/*
		 * -----------------------------------------------------
		 * STEP 2: PREPARE AI PROMPT
		 * -----------------------------------------------------
		 */

		const prompt = `
You are SutrAI, an AI system for development-demand intelligence.

Analyze the following citizen development request.

Citizen request:
${request.trim()}

City / Town:
${location.trim()}

Area / Locality:
${area.trim()}

Specific location:
${specificLocation}

Language:
${language || "English"}

Selected category:
${category || "Auto-detect"}

Return ONLY valid JSON with these exact fields:

{
  "category": "one of the relevant development categories",
  "developmentNeed": "specific development need",
  "urgency": "High, Medium, or Low",
  "affectedArea": "specific affected area",
  "summary": "short factual summary",
  "reasoning": "why this represents a development demand signal"
}

Do not invent infrastructure facts.
Do not claim that a new facility is definitely required.
This is decision-support analysis, not a final government decision.
`;

		/*
		 * -----------------------------------------------------
		 * STEP 3: TRY GEMINI
		 * -----------------------------------------------------
		 */

		let aiAnalysis = null;
		let analysisSource = "Gemini";

		try {
			const result =
				await generateGeminiResponse(prompt);

			const text = extractGeminiText(
				result.response
			);

			aiAnalysis = parseGeminiJson(text);

			if (!aiAnalysis) {
				throw new Error(
					"Gemini returned an unusable analysis format."
				);
			}
		} catch (error) {
			console.warn(
				"Gemini analysis unavailable. Using local fallback:",
				getErrorMessage(error)
			);

			aiAnalysis =
				createLocalCitizenAnalysis({
					request,
					location,
					area,
					language,
					category,
				});

			analysisSource = "Local fallback";
		}

		/*
		 * -----------------------------------------------------
		 * STEP 4: ENSURE REQUIRED FIELDS
		 * -----------------------------------------------------
		 */

		aiAnalysis = {
			category:
				aiAnalysis.category ||
				detectLocalCategory(
					request,
					category
				),

			developmentNeed:
				aiAnalysis.developmentNeed ||
				detectLocalDevelopmentNeed(
					aiAnalysis.category ||
						category ||
						"Other",
					request
				),

			urgency:
				aiAnalysis.urgency ||
				detectLocalUrgency(request),

			affectedArea:
				aiAnalysis.affectedArea ||
				specificLocation,

			summary:
				aiAnalysis.summary ||
				`Citizen demand related to ${specificLocation}.`,

			reasoning:
				aiAnalysis.reasoning ||
				"The request represents a local development-demand signal requiring further investigation.",

			analysisSource,
		};

		/*
		 * -----------------------------------------------------
		 * STEP 5: SAVE REQUEST
		 * -----------------------------------------------------
		 */

		const savedRequest = {
			request: request.trim(),
			location: specificLocation,
			area: area.trim(),
			city: location.trim(),
			language: language || "English",
			selectedCategory:
				category || "Auto-detect",
			coordinates: {
				latitude,
				longitude,
			},
			analysis: aiAnalysis,
		};

		await saveRequest(savedRequest);

		console.log(
			`Citizen request saved using ${analysisSource}.`
		);

		return res.json({
			success: true,
			analysis: JSON.stringify(aiAnalysis),
			coordinates: {
				latitude,
				longitude,
			},
			analysisSource,
		});
	} catch (error) {
		console.error(
			"Citizen analysis route failed:",
			error
		);

		return res.status(500).json({
			success: false,
			message:
				getErrorMessage(error) ||
				"Could not analyze the citizen request.",
		});
	}
});

/* =========================================================
   BACKFILL COORDINATES
   ========================================================= */

app.post(
	"/api/backfill-coordinates",
	async (req, res) => {
		try {
			const result =
				await backfillCoordinates();

			return res.json({
				success: true,
				...result,
			});
		} catch (error) {
			console.error(
				"Coordinate backfill failed:",
				error
			);

			return res.status(500).json({
				success: false,
				message:
					getErrorMessage(error),
			});
		}
	}
);

/* =========================================================
   ALL REQUESTS
   ========================================================= */

app.get("/api/requests", async (req, res) => {
	try {
		const requests = await getRequests();

		return res.json({
			success: true,
			requests,
		});
	} catch (error) {
		console.error(
			"Could not load requests:",
			error
		);

		return res.status(500).json({
			success: false,
			message:
				getErrorMessage(error),
		});
	}
});

/* =========================================================
   DEMAND AGGREGATION
   ========================================================= */

app.get("/api/demand", async (req, res) => {
	try {
		const requests = await getRequests();

		const demand =
			aggregateDemands(requests);

		return res.json({
			success: true,
			demand,
		});
	} catch (error) {
		console.error(
			"Demand aggregation failed:",
			error
		);

		return res.status(500).json({
			success: false,
			message:
				getErrorMessage(error),
		});
	}
});

/* =========================================================
   PRIORITY DATA
   ========================================================= */

app.get("/api/priority", async (req, res) => {
	try {
		const requests = await getRequests();

		const demand =
			aggregateDemands(requests);

		const priorities =
			generatePriorityData(demand);

		return res.json({
			success: true,
			priorities,
		});
	} catch (error) {
		console.error(
			"Priority generation failed:",
			error
		);

		return res.status(500).json({
			success: false,
			message:
				getErrorMessage(error),
		});
	}
});

/* =========================================================
   AI RECOMMENDATIONS
   ========================================================= */

app.post(
	"/api/recommendations",
	async (req, res) => {
		try {
			const requests =
				await getRequests();

			const aggregatedDemand =
				aggregateDemands(requests);

			if (
				!aggregatedDemand ||
				aggregatedDemand.length === 0
			) {
				return res.json({
					success: true,
					recommendations: [],
					analysisSource:
						"No demand data",
				});
			}

			/*
			 * Keep ALL clusters.
			 * Do not use .slice(0, 6).
			 */
			const strongestClusters =
				aggregatedDemand.map(
					(item) => ({
						location: item.location,
						demandGroup:
							item.demandGroup,
						requestCount:
							item.requestCount,
						coordinates:
							item.coordinates ||
							null,
					})
				);

			/*
			 * -------------------------------------------------
			 * GET INFRASTRUCTURE EVIDENCE
			 * -------------------------------------------------
			 *
			 * We use small batches so external services are not
			 * hammered with many simultaneous requests.
			 */

			const infrastructureByLocation =
				new Map();

			const batchSize = 12;

			for (
				let i = 0;
				i < strongestClusters.length;
				i += batchSize
			) {
				const batch =
					strongestClusters.slice(
						i,
						i + batchSize
					);

				await Promise.all(
					batch.map(
						async (cluster) => {
							if (
								!cluster.coordinates
							) {
								return;
							}

							const latitude =
								cluster
									.coordinates
									.latitude ??
								cluster
									.coordinates
									.lat;

							const longitude =
								cluster
									.coordinates
									.longitude ??
								cluster
									.coordinates
									.lon;

							if (
								typeof latitude !==
									"number" ||
								typeof longitude !==
									"number"
							) {
								return;
							}

							try {
    const infrastructure =
        await getInfrastructure(
            latitude,
            longitude
        );

    infrastructureByLocation.set(
        cluster.location.toLowerCase(),
        infrastructure
    );
} catch (error) { 
								console.warn(
									`Infrastructure unavailable for ${cluster.location}:`,
									getErrorMessage(
										error
									)
								);

								infrastructureByLocation.set(
									cluster.location.toLowerCase(),
									null
								);
							}
						}
					)
				);

				if (
					i + batchSize <
					strongestClusters.length
				) {
					await sleep(500);
				}
			}

			/*
			 * -------------------------------------------------
			 * TRY GEMINI RECOMMENDATIONS
			 * -------------------------------------------------
			 */

			const infrastructureContext =
				strongestClusters.map(
					(cluster) => {
						const infrastructure =
							infrastructureByLocation.get(
								cluster.location.toLowerCase()
							);

						return {
							location:
								cluster.location,
							demandGroup:
								cluster.demandGroup,
							requestCount:
								cluster.requestCount,
							coordinates:
								cluster.coordinates,
							infrastructure:
								infrastructure
									? {
											counts:
												infrastructure.counts,
											totalFacilities:
												infrastructure.totalFacilities,
											places:
												infrastructure.places,
											source:
												infrastructure.source,
											dataStatus:
												infrastructure.dataStatus,
											radius:
												infrastructure.radius,
											governmentHospitals:
												infrastructure.governmentHospitals,
									  }
									: null,
						};
					}
				);

			const recommendationPrompt = `
You are SutrAI, a development-demand intelligence system.

Analyze these aggregated citizen demand clusters and the available mapped infrastructure evidence.

DATA:
${JSON.stringify(
	infrastructureContext,
	null,
	2
)}

Generate development recommendations for further investigation.

Return ONLY valid JSON in this exact structure:

{
  "recommendations": [
    {
      "location": "exact location from the supplied data",
      "developmentArea": "development demand area",
      "requestCount": 0,
      "priority": "High, Medium, or Low",
      "reason": "factual explanation using the supplied demand and infrastructure evidence",
      "suggestedAction": "specific next investigation step"
    }
  ]
}

Rules:
- Use only locations supplied in the data.
- Do not invent infrastructure facilities.
- Do not treat unavailable infrastructure data as zero.
- A count of 0 means no matching facilities were mapped.
- An unavailable value means the infrastructure source could not be confirmed.
- Recommendations are decision-support signals, not final government decisions.
- Do not automatically recommend constructing new infrastructure merely because citizen demand exists.
`;

			let recommendations = null;
			let recommendationSource =
				"Gemini";

			try {
				const result =
					await generateGeminiResponse(
						recommendationPrompt
					);

				const text =
					extractGeminiText(
						result.response
					);

				const parsed =
					parseGeminiJson(text);

				if (
					Array.isArray(
						parsed?.recommendations
					)
				) {
					recommendations =
						parsed.recommendations;
				} else if (
					Array.isArray(parsed)
				) {
					recommendations =
						parsed;
				} else {
					throw new Error(
						"Gemini returned an invalid recommendation structure."
					);
				}
			} catch (error) {
				console.warn(
					"Gemini recommendations unavailable. Using local fallback:",
					getErrorMessage(error)
				);

				recommendationSource =
					"Local fallback";
			}

			/*
			 * -------------------------------------------------
			 * NORMALIZE GEMINI OUTPUT
			 * OR BUILD LOCAL FALLBACK
			 * -------------------------------------------------
			 */

			if (
				!Array.isArray(
					recommendations
				) ||
				recommendations.length === 0
			) {
				recommendations =
					strongestClusters.map(
						(cluster) =>
							createLocalRecommendation(
								cluster,
								infrastructureByLocation.get(
									cluster.location.toLowerCase()
								)
							)
					);
			} else {
				/*
				 * Enrich and normalize Gemini output.
				 * This prevents missing fields from breaking
				 * the frontend.
				 */

				recommendations =
					recommendations.map(
						(item, index) => {
							const location =
								typeof item.location ===
								"string"
									? item.location
									: strongestClusters[
											index
									  ]?.location ||
									  "Unknown location";

							const matchingCluster =
								strongestClusters.find(
									(cluster) =>
										cluster.location.toLowerCase() ===
										location.toLowerCase()
								) ||
								strongestClusters[
									index
								];

							const infrastructure =
								infrastructureByLocation.get(
									(
										matchingCluster
											?.location ||
										location
									).toLowerCase()
								);

							const developmentArea =
								item.developmentArea ||
								matchingCluster?.demandGroup ||
								"Public Infrastructure";

							const requestCount =
								Number(
									item.requestCount
								) ||
								matchingCluster?.requestCount ||
								0;

							const infraCount =
								infrastructure
									?.counts
									? getInfrastructureCountForDemand(
											developmentArea,
											infrastructure.counts
									  )
									: null;

							return {
								location,
								developmentArea,
								requestCount,
								priority:
									item.priority ||
									getLocalPriority(
										requestCount,
										infraCount
									),
								reason:
									item.reason ||
									`This area has ${requestCount} citizen demand signal${
										requestCount ===
										1
											? ""
											: "s"
									} related to ${developmentArea.toLowerCase()}.`,
								suggestedAction:
									item.suggestedAction ||
									"Verify the demand locally and review existing infrastructure before planning an intervention.",
								coordinates:
									matchingCluster?.coordinates ||
									null,
								infrastructureEvidence:
									buildInfrastructureEvidence(
										infrastructure,
										developmentArea
									),
								analysisSource:
									recommendationSource,
							};
						}
					);
			}

			/*
			 * -------------------------------------------------
			 * RETURN
			 * -------------------------------------------------
			 */

			return res.json({
				success: true,
				recommendations,
				analysisSource:
					recommendationSource,
			});
		} catch (error) {
			console.error(
				"Recommendation route failed:",
				error
			);

			return res.status(500).json({
				success: false,
				message:
					getErrorMessage(error) ||
					"Could not generate recommendations.",
			});
		}
	}
);

/* =========================================================
   INFRASTRUCTURE
   ========================================================= */

app.get(
	"/api/infrastructure",
	async (req, res) => {
		try {
			const latitude =
				Number(req.query.latitude);

			const longitude =
				Number(req.query.longitude);

			if (
				!Number.isFinite(latitude) ||
				!Number.isFinite(longitude)
			) {
				return res.status(400).json({
					success: false,
					message:
						"Valid latitude and longitude are required.",
				});
			}

			const infrastructure =
				await getInfrastructure(
					latitude,
					longitude
				);

			return res.json({
				success: true,
				infrastructure,
			});
		} catch (error) {
			console.error(
				"Infrastructure route failed:",
				error
			);

			return res.status(500).json({
				success: false,
				message:
					getErrorMessage(error),
			});
		}
	}
);

/* =========================================================
   LOCATION
   ========================================================= */

app.get("/api/location", async (req, res) => {
	try {
		const query =
			req.query.name ||
			req.query.location;

		if (!query) {
			return res.status(400).json({
				success: false,
				message:
					"Location name is required.",
			});
		}

		const coordinates =
			await getLocationCoordinates(
				query
			);

		if (!coordinates) {
			return res.status(404).json({
				success: false,
				message:
					"Location could not be found.",
			});
		}

		return res.json({
			success: true,
			coordinates,
		});
	} catch (error) {
		console.error(
			"Location lookup failed:",
			error
		);

		return res.status(500).json({
			success: false,
			message:
				getErrorMessage(error),
		});
	}
});

/* =========================================================
   AREA INTELLIGENCE
   ========================================================= */

app.get(
	"/api/area-intelligence",
	async (req, res) => {
		try {
			const name = req.query.name;

			if (!name) {
				return res.status(400).json({
					success: false,
					message:
						"Area name is required.",
				});
			}

			const requests =
				await getRequests();

			const demand =
				aggregateDemands(requests);

			const matchingDemand =
				demand.filter(
					(item) =>
						item.location
							?.toLowerCase() ===
						name.toLowerCase()
				);

			let coordinates =
				matchingDemand[0]?.coordinates ||
				null;

			if (!coordinates) {
				try {
					coordinates =
						await getLocationCoordinates(
							name
						);
				} catch (error) {
					console.error(
						"Area geocoding failed:",
						getErrorMessage(
							error
						)
					);
				}
			}

			if (!coordinates) {
				return res.status(404).json({
					success: false,
					message:
						`Could not find coordinates for "${name}".`,
				});
			}

			const latitude =
				coordinates.latitude ??
				coordinates.lat;

			const longitude =
				coordinates.longitude ??
				coordinates.lon;

            let infrastructure = null;

            try {
                infrastructure = await getInfrastructure(
                    latitude,
                    longitude
                );
            } catch (error) {
                console.warn(
                    "Area infrastructure unavailable:",
                    getErrorMessage(error)
                );

                infrastructure = {
                    radius: 5000,
                    counts: null,
                    totalFacilities: null,
                    places: [],
                    source: "OpenStreetMap - data unavailable",
                    dataStatus: "osm_unavailable",
                    governmentHospitals: {
                        count: 0,
                        places: [],
                        source:
                            "National Hospital Directory - data.gov.in",
                    },
                };
            }

            const areaDemand = matchingDemand;

			const total =
				areaDemand.reduce(
					(sum, item) =>
						sum +
						(Number(
							item.requestCount
						) || 0),
					0
				);

			const categoryBreakdown =
				areaDemand
					.map((item) => ({
						category:
							item.demandGroup,
						count:
							item.requestCount,
					}))
					.sort(
						(a, b) =>
							b.count - a.count
					);

			const highestDemand =
				categoryBreakdown[0] ||
				null;

			return res.json({
				success: true,
				area: name,
				coordinates: {
					latitude,
					longitude,
				},
				demand: areaDemand,
				total,
				categoryBreakdown,
				highestDemand,
				infrastructure,
			});
		} catch (error) {
			console.error(
				"Area intelligence failed:",
				error
			);

			return res.status(500).json({
				success: false,
				message:
					getErrorMessage(error),
			});
		}
	}
);

/* =========================================================
   GOVERNMENT HOSPITALS
   ========================================================= */

app.get(
	"/api/government-hospitals",
	async (req, res) => {
		try {
			const latitude =
				Number(req.query.latitude);

			const longitude =
				Number(req.query.longitude);

			const radiusKm =
				Number(req.query.radiusKm) ||
				5;

			if (
				!Number.isFinite(latitude) ||
				!Number.isFinite(longitude)
			) {
				return res.status(400).json({
					success: false,
					message:
						"Valid latitude and longitude are required.",
				});
			}

			const hospitals =
				getGovernmentHospitals(
					latitude,
					longitude,
					radiusKm
				);

			return res.json({
				success: true,
				hospitals,
				count: hospitals.length,
				radiusKm,
			});
		} catch (error) {
			console.error(
				"Government hospital lookup failed:",
				error
			);

			return res.status(500).json({
				success: false,
				message:
					getErrorMessage(error),
			});
		}
	}
);

/* =========================================================
   START SERVER
   ========================================================= */

if (!GEMINI_API_KEY) {
	console.warn(
		"WARNING: GEMINI_API_KEY is not configured. SutrAI will use local fallback analysis."
	);
} else {
	console.log(
		"Gemini API key detected. SutrAI will use Gemini with local fallback."
	);
}

app.listen(PORT, () => {
	console.log(
		`SutrAI backend running on http://localhost:${PORT}`
	);
});
