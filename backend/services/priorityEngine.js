function calculatePriority(demand) {
	const requestCount = demand.requestCount || 0;

	// Demand signal: more repeated requests = stronger signal.
	const demandScore = Math.min(requestCount * 15, 60);

	// Repeated demand gets a small additional concentration signal.
	const concentrationScore =
		requestCount >= 3
			? 20
			: requestCount === 2
				? 12
				: 5;

	const score = Math.min(
		100,
		demandScore + concentrationScore
	);

	let priority = "Low";

	if (score >= 70) {
		priority = "High";
	} else if (score >= 40) {
		priority = "Medium";
	}

	return {
		score,
		priority,
	};
}

function generatePriorityData(aggregatedDemand) {
	return aggregatedDemand.map((demand) => {
		const result = calculatePriority(demand);

		return {
			location: demand.location,
			developmentArea: demand.demandGroup,
			requestCount: demand.requestCount,
			priority: result.priority,
			score: result.score,
			reason:
				`This area has ${demand.requestCount} citizen demand signal${
					demand.requestCount === 1 ? "" : "s"
				} for ${demand.demandGroup}. ` +
				`The score represents the strength and concentration of the available demand data.`,
		};
	});
}

module.exports = {
	calculatePriority,
	generatePriorityData,
};