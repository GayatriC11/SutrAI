import { useEffect, useMemo, useState } from "react";

import CitizenInput from "./CitizenInput";

import "./App.css";
import DevelopmentMap from "./DevelopmentMap";

const API_BASE = "https://sutrai-backend.onrender.com";

// Cache Area Intelligence results and share in-flight requests.
// This prevents duplicate requests during React development remounts.
const areaInfrastructureCache = new Map();
const areaInfrastructureRequests = new Map();

async function fetchAreaInfrastructure(area) {
	if (areaInfrastructureCache.has(area)) {
		return areaInfrastructureCache.get(area);
	}

	if (areaInfrastructureRequests.has(area)) {
		return areaInfrastructureRequests.get(area);
	}

	const requestPromise = fetch(
		`${API_BASE}/api/area-intelligence?name=${encodeURIComponent(area)}`
	)
		.then(async (response) => {
			const data = await response.json();

			if (!response.ok || !data.success) {
				throw new Error(
					data.message || "Infrastructure data unavailable"
				);
			}

			areaInfrastructureCache.set(area, data);
			return data;
		})
		.finally(() => {
			areaInfrastructureRequests.delete(area);
		});

	areaInfrastructureRequests.set(area, requestPromise);
	return requestPromise;
}

const navigationItems = [
	"Overview",
	"Citizen Input",
	"Development Map",
	"Area Intelligence",
	"AI Recommendations",
];

function App() {
	const [currentPage, setCurrentPage] = useState("Overview");

	const [demand, setDemand] = useState([]);
	const [demandLoading, setDemandLoading] = useState(false);

	const [areaInfrastructure, setAreaInfrastructure] = useState(null);
	const [infrastructureLoading, setInfrastructureLoading] =
		useState(false);


	const [selectedArea, setSelectedArea] = useState("");
    const [facilityFilter, setFacilityFilter] = useState("healthcare");
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

	const [recommendations, setRecommendations] = useState([]);
	const [recommendationsLoading, setRecommendationsLoading] =
		useState(false);
	const [recommendationsError, setRecommendationsError] =
		useState("");

	// LOAD DEMAND
	useEffect(() => {
		async function loadDemand() {
			setDemandLoading(true);

			try {
				const response = await fetch(
					`${API_BASE}/api/demand`
				);

				const data = await response.json();

				if (data.success) {
					setDemand(data.demand || []);
				}
			} catch (error) {
				console.error(
					"Could not load SutrAI demand:",
					error
				);
			} finally {
				setDemandLoading(false);
			}
		}

		loadDemand();
	}, [currentPage]);

	// LOAD PRIORITY DATA



	// LOAD AI RECOMMENDATIONS
	useEffect(() => {
		if (currentPage !== "AI Recommendations") {
			return;
		}

		async function loadRecommendations() {
			setRecommendationsLoading(true);
			setRecommendationsError("");

			try {
				const response = await fetch(
					`${API_BASE}/api/recommendations`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
					}
				);

				const data = await response.json();

				if (!data.success) {
					throw new Error(
						data.message ||
							"Could not generate recommendations"
					);
				}

				setRecommendations(
					data.recommendations || []
				);
			} catch (error) {
				console.error(
					"Recommendation error:",
					error
				);

				setRecommendationsError(
					"Could not generate AI recommendations. Make sure the backend is running."
				);
			} finally {
				setRecommendationsLoading(false);
			}
		}

		loadRecommendations();
	}, [currentPage]);

	// SUMMARY DATA
	const totalRequests = demand.reduce(
		(total, item) => total + item.requestCount,
		0
	);

	const uniqueLocations = [
		...new Set(demand.map((item) => item.location)),
	];

	const highDemandClusters = demand.filter(
		(item) => item.requestCount >= 2
	).length;

	const locationCounts = demand.reduce((counts, item) => {
		const location = item.location;

		if (!counts[location]) {
			counts[location] = 0;
		}

		counts[location] += item.requestCount;

		return counts;
	}, {});


	const categoryCounts = demand.reduce((counts, item) => {
		const category = item.demandGroup;

		if (!counts[category]) {
			counts[category] = 0;
		}

		counts[category] += item.requestCount;

		return counts;
	}, {});

	const topLocations = Object.entries(locationCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6);

	const topCategories = Object.entries(categoryCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6);

	const topDemandClusters = [...demand]
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 6);

    // Aggregate all demand signals by area for Priority Intelligence.
    const priorityAreas = Object.entries(locationCounts)
    .map(([location, requestCount]) => {
        const areaDemands = demand
            .filter((item) => item.location === location)
            .sort(
                (a, b) =>
                    b.requestCount - a.requestCount
            );

        const strongestDemand = areaDemands[0] || null;

        return {
            location,
            requestCount,
            demandGroup:
                strongestDemand?.demandGroup ||
                "Development Demand",
            coordinates:
                strongestDemand?.coordinates || null,
        };
    })
    .sort(
        (a, b) =>
            b.requestCount - a.requestCount
    );

    const highestPriority =
    priorityAreas[0] || null;

	const getDemandStrength = (count) => {
		if (count >= 4) return "High";
		if (count >= 2) return "Medium";
		return "Low";
	};

	const summaryCards = [
		{
			label: "Citizen Requests",
			value: demandLoading
	  			? "—"
				: totalRequests.toLocaleString(),
			change: "Live",
			note: "analyzed requests",
			tone: "blue",
			icon: "↗",
		},
		{
			label: "Areas Analyzed",
			value: demandLoading
				? "—"
				: uniqueLocations.length,
			change: "Live",
			note: "locations with demand",
			tone: "teal",
			icon: "⌖",
		},
		{
			label: "High Demand Clusters",
			value: demandLoading
				? "—"
				: highDemandClusters,
			change: "2+ requests",
			note: "aggregated signals",
			tone: "orange",
			icon: "!",
		},
	];

	// AREA INTELLIGENCE
	const areaOptions = useMemo(() => {
		return [...uniqueLocations].sort();
	}, [demand]);

	useEffect(() => {
		if (!selectedArea && areaOptions.length > 0) {
			setSelectedArea(areaOptions[0]);
		}
	}, [areaOptions, selectedArea]);

	// LOAD REAL INFRASTRUCTURE DATA
	useEffect(() => {
		let ignore = false;

		if (!selectedArea) {
			setAreaInfrastructure(null);
			setInfrastructureLoading(false);
			return () => {
				ignore = true;
			};
		}

		// Show cached data immediately when this area was already loaded.
		if (areaInfrastructureCache.has(selectedArea)) {
			setAreaInfrastructure(
				areaInfrastructureCache.get(selectedArea)
			);
			setInfrastructureLoading(false);
			return () => {
				ignore = true;
			};
		}

		setInfrastructureLoading(true);

		fetchAreaInfrastructure(selectedArea)
			.then((data) => {
				if (!ignore) {
					setAreaInfrastructure(data);
				}
			})
			.catch((error) => {
				if (ignore) {
					return;
				}

				console.error(
					"Infrastructure fetch error:",
					error
				);
				setAreaInfrastructure(null);
			})
			.finally(() => {
				if (!ignore) {
					setInfrastructureLoading(false);
				}
			});

		return () => {
			ignore = true;
		};
	}, [selectedArea]);

	const selectedAreaData = useMemo(() => {
		if (!selectedArea) {
			return null;
		}

		const areaDemand = demand.filter(
			(item) => item.location === selectedArea
		);

		const total = areaDemand.reduce(
			(sum, item) => sum + item.requestCount,
			0
		);

		const categoryBreakdown = areaDemand
			.map((item) => ({
				category: item.demandGroup,
				count: item.requestCount,
			}))
			.sort((a, b) => b.count - a.count);

		const highestDemand = categoryBreakdown[0] || null;

		return {
			areaDemand,
			total,
			categoryBreakdown,
			highestDemand,
		};
	}, [demand, selectedArea]);

	const getDemandPercentage = (count, total) => {
		if (!total) {
			return 0;
		}

		return Math.round((count / total) * 100);
	};

	// GAP ANALYSIS
	const getGapAnalysis = () => {
		if (
			!selectedAreaData ||
			!selectedAreaData.highestDemand
		) {
			return null;
		}

		const highest = selectedAreaData.highestDemand;

		const counts =
			areaInfrastructure?.infrastructure?.counts || {};

		let infrastructureCount = null;
		let infrastructureLabel = "";

		if (
			highest.category ===
			"Healthcare Infrastructure"
		) {
			infrastructureCount = counts.healthcare;
			infrastructureLabel = "healthcare facilities";
		} else if (
			highest.category ===
			"Education Infrastructure"
		) {
			infrastructureCount = counts.education;
			infrastructureLabel = "education facilities";
		} else if (
            highest.category ===
            "Roads & Connectivity" ||
            highest.category ===
            "Public Transportation"
        ) {
               infrastructureCount = counts.transport;
              infrastructureLabel = "mapped transport points";
        }           

		if (infrastructureCount === undefined || infrastructureCount === null) {
			infrastructureCount = null;
		}

		if (infrastructureCount === null) {
			return {
				status: "Data unavailable",
				title:
					"Infrastructure comparison unavailable",
				description:
					"Mapped infrastructure data is not available for this demand category yet.",
			};
		}

		if (infrastructureCount === 0) {
			return {
				status: "Potential gap",
				title:
					"Strong demand with no mapped facilities",
				description: `Citizen demand for ${highest.category} is present, but no matching facilities were mapped within 5 km. This is a stronger infrastructure-gap signal that should be investigated further.`,
			};
		}

		return {
			status: "Mapped infrastructure exists",
			title:
				"Mapped infrastructure exists, but accessibility, capacity or service availability may still need investigation.",
			description: `${highest.count} citizen request${
				highest.count === 1 ? "" : "s"
			} indicate demand for ${highest.category}, while ${infrastructureCount} matching ${infrastructureLabel} are already mapped within 5 km. Instead of assuming that new infrastructure is required, investigate accessibility, capacity, distribution or service quality.`,
		};
	};

	const gapAnalysis = getGapAnalysis();

	const getAreaInsight = () => {
		if (
			!selectedAreaData ||
			selectedAreaData.total === 0
		) {
			return "No citizen demand has been recorded for this area yet.";
		}

		const highest = selectedAreaData.highestDemand;

		if (!highest) {
			return "Citizen demand is still being analyzed.";
		}

		const healthcareCount =
			areaInfrastructure?.infrastructure?.counts
				?.healthcare;

		if (
			highest.category ===
				"Healthcare Infrastructure" &&
			healthcareCount !== undefined
		) {
			return `${selectedArea} shows its strongest citizen demand in healthcare, with ${
				highest.count
			} recorded request${
				highest.count === 1 ? "" : "s"
			}. OpenStreetMap currently maps ${healthcareCount} ${
				healthcareCount === 1
					? "healthcare facility"
					: "healthcare facilities"
			} within 5 km. This suggests the demand should be investigated for accessibility, capacity or service gaps rather than assuming that a new facility is automatically required.`;
		}

		return `${selectedArea} shows its strongest development demand in ${highest.category}, representing ${highest.count} of ${selectedAreaData.total} recorded requests. This indicates a concentrated demand signal that can be investigated further alongside existing infrastructure before planning interventions.`;
	};

	return (
		<div className="app-shell">
			<header className="topbar">
				
				<div className="brand">
					<div className="brand-mark">
                 <img src="/src/assets/logo.png" alt="SutrAI logo" />
                    </div>

					<div>
						<div className="brand-name">
							SutrAI
						</div>

						<div className="brand-tagline">
							Development Demand Intelligence
						</div>
					</div>
				</div>
                <button
                    className="mobile-menu-button"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    aria-label="Toggle navigation"
                >
                    {mobileMenuOpen ? "✕" : "☰"}
                </button>                
				<div className="topbar-status">
					<span className="status-dot"></span>
					Live Intelligence System
				</div>
			</header>

{mobileMenuOpen && (
    <div className="mobile-menu">
        {navigationItems.map((item) => (
            <button
                key={item}
                className={`mobile-nav-item ${
                    currentPage === item ? "active" : ""
                }`}
                onClick={() => {
                    setCurrentPage(item);
                    setMobileMenuOpen(false);
                }}
            >
                {item}
            </button>
        ))}
    </div>
)}

			<div className="app-layout">
				<aside className="sidebar">
					<div className="sidebar-label">
						COMMAND CENTER
					</div>

					<nav>
						{navigationItems.map((item) => (
							<button
								key={item}
								className={`nav-item ${
									currentPage === item
										? "active"
										: ""
								}`}
								onClick={() =>
									setCurrentPage(item)
								}
							>
								<span>
									{item === "Overview" &&
										"⌂"}

									{item ===
										"Citizen Input" &&
										"✦"}

									{item ===
										"Development Map" &&
										"⌖"}

									{item ===
										"Area Intelligence" &&
										"◉"}

									{item ===
										"AI Recommendations" &&
										"✧"}
								</span>

								{item}
							</button>
						))}
					</nav>

					<div className="sidebar-footer">
						<div className="system-status">
							<span className="status-dot"></span>

							<span>
								System Operational
							</span>
						</div>
					</div>
				</aside>

				<main className="main-content">


{/* OVERVIEW */}

					{currentPage === "Overview" && (
						<>
							<section className="hero-section">
								<div>
									<div className="section-kicker">
										AI-POWERED DEVELOPMENT
										INTELLIGENCE
									</div>

									<h1>
										Connecting the
										threads
										<br />
										of India's
										development.
									</h1>

									<p>
										SutrAI transforms
										scattered citizen
										requests into
										structured
										development
										signals, demand
										hotspots and
										actionable
										intelligence.
									</p>
								</div>
							</section>

							<section className="summary-grid">
								{summaryCards.map((card) => (
									<div
										className={`summary-card ${card.tone}`}
										key={card.label}
									>
										<div className="summary-top">
											<span>
												{card.label}
											</span>

											<span className="summary-icon">
												{card.icon}
											</span>
										</div>

										<div className="summary-value">
											{card.value}
										</div>

										<div className="summary-bottom">
											<span>
												{card.change}
											</span>

											<span>
												{card.note}
											</span>
										</div>
									</div>
								))}
							</section>

							<section className="overview-intelligence">
								<div className="intelligence-card">
									<div className="section-kicker">
										STRONGEST DEMAND SIGNAL
									</div>

									{highestPriority ? (
										<>
											<h2>
												{highestPriority.developmentArea}
											</h2>

											<p className="intelligence-location">
												{highestPriority.location}
											</p>

											<div className="intelligence-stats">
												<div>
													<span>Citizen demand</span>
													<strong>
														{highestPriority.requestCount} signals
													</strong>
												</div>

												<div>
													<span>Demand strength</span>
													<strong>{getDemandStrength(highestPriority.requestCount)}</strong>
												</div>
											</div>

											<p className="intelligence-description">
												This is the strongest recurring
												development demand in the
												current citizen request data.
												SutrAI flags it for further
												investigation and planning.
											</p>
										</>
									) : (
										<p>
											No citizen demand signals are
											available yet.
										</p>
									)}
								</div>

								<div className="intelligence-card intelligence-card-secondary">
									<div className="section-kicker">
										WHAT SUTRAI DOES
									</div>

									<h2>
										From scattered requests to
										development intelligence.
									</h2>

									<p>
										SutrAI combines citizen demand,
										location signals and mapped
										infrastructure to help identify
										areas that deserve closer
										investigation.
									</p>

									<div className="intelligence-flow">
										<span>Citizen signals</span>
										<span>→</span>
										<span>Demand hotspots</span>
										<span>→</span>
										<span>AI recommendations</span>
									</div>
								</div>
							</section>



							<section className="sutrai-flow">
								<div className="section-kicker">HOW SUTRAI WORKS</div>

								<h2>From citizen voices to development intelligence.</h2>

								<div className="flow-steps">
									<div className="flow-step">
										<div className="flow-number">01</div>
										<h3>Citizen Input</h3>
										<p>Citizens share local development needs through simple text or voice.</p>
									</div>

									<div className="flow-arrow">→</div>

									<div className="flow-step">
										<div className="flow-number">02</div>
										<h3>AI Structuring</h3>
										<p>AI converts unstructured requests into clear development signals.</p>
									</div>

									<div className="flow-arrow">→</div>

									<div className="flow-step">
										<div className="flow-number">03</div>
										<h3>Demand Aggregation</h3>
										<p>Similar requests are grouped to reveal recurring local demand.</p>
									</div>

									<div className="flow-arrow">→</div>

									<div className="flow-step">
										<div className="flow-number">04</div>
										<h3>Infrastructure Context</h3>
										<p>Mapped infrastructure is considered alongside citizen demand.</p>
									</div>

									<div className="flow-arrow">→</div>

									<div className="flow-step">
										<div className="flow-number">05</div>
										<h3>Development Insight</h3>
										<p>SutrAI surfaces priorities for further investigation.</p>
									</div>
								</div>
							</section>

							<section className="content-grid">
								<div className="panel">
									<div className="panel-heading">
										<div>
											<div className="section-kicker">
												GEOGRAPHIC
												SIGNALS
											</div>

											<h2>
												Development
												Demand Map
											</h2>
										</div>

										<button
											className="outline-button"
											onClick={() =>
												setCurrentPage(
													"Development Map"
												)
											}
										>
											Explore map →
										</button>
									</div>

									<div className="map-preview">
										{topLocations.length ===
										0 ? (
											<div className="empty-state">
												No location
												data
												available
												yet.
											</div>
										) : (
											topLocations.map(
												(
													[
														location,
														count,
													],
													index
												) => (
													<div
														className={`map-node node-${
															index +
															1
														}`}
														key={
															location
														}
													>
														<div className="map-pulse"></div>

														<div className="map-label">
															<strong>
																{
																	location
																}
															</strong>

															<span>
																{
																	count
																}{" "}
																requests
															</span>
														</div>
													</div>
												)
											)
										)}
									</div>
								</div>

								<div className="panel">
									<div className="panel-heading">
										<div>
											<div className="section-kicker">
												DEMAND
												SIGNALS
											</div>

											<h2>
												Top Development
												Needs
											</h2>
										</div>
									</div>

									<div className="needs-list">
										{topCategories.map(
											([
												category,
												count,
											]) => (
												<div
													className="need-row"
													key={
														category
													}
												>
													<div className="need-info">
														<span>
															{
																category
															}
														</span>

														<strong>
															{
																count
															}
														</strong>
													</div>

													<div className="progress-track">
														<div
															className="progress-bar"
															style={{
																width: `${
																	(count /
																		Math.max(
																			...Object.values(
																				categoryCounts
																			)
																		)) *
																	100
																}%`,
															}}
														></div>
													</div>
												</div>
											)
										)}
									</div>
								</div>
							</section>

							{/* PRIORITY INTELLIGENCE */}
<section className="content-grid">
	<div className="panel">
		<div className="panel-heading">
			<div>
				<div className="section-kicker">
					PRIORITY INTELLIGENCE
				</div>

				<h2>
					Where should attention come first?
				</h2>
			</div>
		</div>

		<p>
			SutrAI identifies the strongest recurring development-demand
			signals so that areas can be investigated based on actual
			citizen demand.
		</p>

		{demandLoading ? (
			<p>Analyzing demand signals...</p>
		) : highestPriority ? (
			<>
				<div className="area-stat-grid">
					<div className="area-stat-card">
						<span>Demand strength</span>
						<strong>
                            {getDemandStrength(highestPriority.requestCount)}
                        </strong>
					</div>

					<div className="area-stat-card">
						<span>Demand signals</span>
						<strong>
							{highestPriority.requestCount}
						</strong>
					</div>

					<div className="area-stat-card">
						<span>Location</span>
						<strong>
							{highestPriority.location}
						</strong>
					</div>

					<div className="area-stat-card">
						<span>Development area</span>
						<strong>
							{highestPriority.demandGroup}
						</strong>
					</div>
				</div>

				<div className="insight-note">
					<span>i</span>

					<div>
						<strong>
							Why this area?
						</strong>

						<p>
							This area currently has the highest
                            combined citizen demand in the available
                            request data. SutrAI flags it for further
                            investigation, while considering the
                            strongest development need reported there.
						</p>
					</div>
				</div>
			</>
		) : (
			<p>
				No demand intelligence is available yet.
			</p>
		)}
	</div>
</section>
						</>
					)}

					{/* CITIZEN INPUT */}

					{currentPage === "Citizen Input" && (
						<section className="page-section">
							<div className="section-kicker">
								CITIZEN SIGNAL COLLECTION
							</div>

							<h1>
								Submit a Development Need
							</h1>

							<p className="page-description">
								Citizens can submit local
								development needs in their
								own words. SutrAI structures
								the request and adds it to
								the development intelligence
								system.
							</p>

							<CitizenInput />
						</section>
					)}

					{/* DEVELOPMENT MAP */}
{currentPage === "Development Map" && (
	<section className="page-section">
		<div className="section-kicker">
			GEOSPATIAL DEMAND INTELLIGENCE
		</div>

		<h1>Development Demand Map</h1>

		<p className="page-description">
			Aggregated citizen signals reveal where development
			demand is concentrated across different areas.
		</p>

		<div className="panel">
			<div className="panel-heading">
				<div>
					<div className="section-kicker">
						LIVE DEMAND HOTSPOTS
					</div>

					<h2>Citizen Demand Geography</h2>
				</div>
			</div>

			<DevelopmentMap demand={demand} />
		</div>

		<div className="content-grid">
			<div className="panel">
				<div className="panel-heading">
					<div>
						<div className="section-kicker">
							LOCATIONS
						</div>

						<h2>Demand by Area</h2>
					</div>
				</div>

				<div className="needs-list">
					{topLocations.map(([location, count]) => (
						<div
							className="need-row"
							key={location}
						>
							<div className="need-info">
								<span>{location}</span>
								<strong>{count}</strong>
							</div>

							<div className="progress-track">
								<div
									className="progress-bar"
									style={{
										width: `${
											(count /
												Math.max(
													...Object.values(
														locationCounts
													)
												)) *
											100
										}%`,
									}}
								></div>
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="panel">
				<div className="panel-heading">
					<div>
						<div className="section-kicker">
							HIGH-DEMAND CLUSTERS
						</div>

						<h2>Aggregated Signals</h2>
					</div>
				</div>

				<div className="needs-list">
					{topDemandClusters.map((item) => (
						<div
							className="demand-cluster"
							key={`${item.location}-${item.demandGroup}`}
						>
							<div>
								<strong>{item.location}</strong>

								<span>{item.demandGroup}</span>
							</div>

							<div className="cluster-count">
								{item.requestCount}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	</section>
)}


{/* AREA INTELLIGENCE */}

					{currentPage === "Area Intelligence" && (
						<section className="page-section">
							<div className="section-kicker">
								LOCALIZED DEVELOPMENT
								INTELLIGENCE
							</div>

							<h1>Area Intelligence</h1>

							<p className="page-description">
								Select an area to understand
								what development needs are
								emerging most strongly from
								citizen signals and how they
								compare with mapped
								infrastructure.
							</p>

							<div className="area-selector-panel">
								<div>
									<div className="section-kicker">
										SELECT AREA
									</div>

									<h2>
										Explore local demand
									</h2>
								</div>

								<select
									value={selectedArea}
									onChange={(event) =>
										setSelectedArea(
											event.target
												.value
										)
									}
									className="area-select"
								>
									{areaOptions.map(
										(area) => (
											<option
												key={area}
												value={area}
											>
												{area}
											</option>
										)
									)}
								</select>
							</div>

							{selectedAreaData && (
								<>
									<div className="area-stat-grid">
										<div className="area-stat-card">
											<span>
												Total Citizen
												Demand
											</span>

											<strong>
												{
													selectedAreaData.total
												}
											</strong>

											<small>
												recorded
												requests
											</small>
										</div>

										<div className="area-stat-card">
											<span>
												Development
												Areas
											</span>

											<strong>
												{
													selectedAreaData
														.categoryBreakdown
														.length
												}
											</strong>

											<small>
												demand
												categories
											</small>
										</div>

										<div className="area-stat-card">
											<span>
												Highest Demand
											</span>

											<strong className="small-stat">
												{selectedAreaData
													.highestDemand
													?.category ||
													"None"}
											</strong>

											<small>
												strongest
												signal
											</small>
										</div>
									</div>

 {/* REAL INFRASTRUCTURE DATA */}

<div className="area-stat-grid">

    <div className="area-stat-card">
        <span>
            Mapped
            Healthcare
        </span>

        {infrastructureLoading ? (
            <div
    style={{
        fontSize: "22px",
        fontWeight: "700",
        letterSpacing: "5px",
        color: "#0d365a",
        lineHeight: "32px",
    }}
>
    •••
</div>
        ) : (
            <strong>
                {areaInfrastructure
                    ?.infrastructure
                    ?.counts
                    ?.healthcare ?? "—"}
            </strong>
        )}

        <small>
            within 5 km
        </small>
    </div>


    <div className="area-stat-card">
        <span>
            Mapped
            Education
        </span>

        {infrastructureLoading ? (
            <div
    style={{
        fontSize: "22px",
        fontWeight: "700",
        letterSpacing: "5px",
        color: "#0d365a",
        lineHeight: "32px",
    }}
>
    •••
</div>
        ) : (
            <strong>
                {areaInfrastructure
                    ?.infrastructure
                    ?.counts
                    ?.education ?? "—"}
            </strong>
        )}

        <small>
            within 5 km
        </small>
    </div>


    <div className="area-stat-card">
        <span>
            Mapped
            Transport
        </span>

        {infrastructureLoading ? (
            <div
    style={{
        fontSize: "22px",
        fontWeight: "700",
        letterSpacing: "5px",
        color: "#0d365a",
        lineHeight: "32px",
    }}
>
    •••
</div>
        ) : (
            <strong>
                {areaInfrastructure
                    ?.infrastructure
                    ?.counts
                    ?.transport ?? "—"}
            </strong>
        )}

        <small>
            within 5 km
        </small>
    </div>

</div>

			<div className="content-grid">
				<div className="panel">
					<div className="panel-heading">
						<div>
							<div className="section-kicker">
								DEMAND
								DISTRIBUTION
							</div>

							<h2>
								{
									selectedArea
								}{" "}
								Development
														Needs
													</h2>
												</div>
											</div>

											<div className="needs-list">
												{selectedAreaData.categoryBreakdown.map(
													(item) => (
														<div
															className="need-row"
															key={
																item.category
															}
														>
															<div className="need-info">
																<span>
																	{
																		item.category
																	}
																</span>

																<strong>
																	{
																		item.count
																	}
																</strong>
															</div>

															<div className="progress-track">
																<div
																	className="progress-bar"
																	style={{
																		width: `${getDemandPercentage(
																			item.count,
																			selectedAreaData.total
																		)}%`,
																	}}
																></div>
															</div>

															<small>
																{getDemandPercentage(
																	item.count,
																	selectedAreaData.total
																)}
																%
															</small>
														</div>
													)
												)}
											</div>
										</div>

										{/* GAP ANALYSIS */}

										<div className="panel gap-analysis-panel">
											<div className="section-kicker">
												DEMAND VS MAPPED INFRASTRUCTURE
											</div>

											<h2>
												Infrastructure
												Gap Analysis
											</h2>

											{gapAnalysis ? (
												<>
													<div className="gap-status">
														{
															gapAnalysis.status
														}
													</div>

													<h3>
														{
															gapAnalysis.title
														}
													</h3>

													<p>
														{
															gapAnalysis.description
														}
													</p>
												</>
											) : (
												<p>
													Not enough
													data to
													compare
													demand with
													existing
													infrastructure.
												</p>
											)}
										</div>
									</div>

									<div className="content-grid">
										<div className="panel insight-panel">
											<div className="section-kicker">
												SUTRAI
												INTERPRETATION
											</div>

											<h2>
												What the signals
												suggest
											</h2>

											<p>
												{getAreaInsight()}
											</p>

											<div className="insight-note">
												<span>i</span>

												<div>
													This is an
													evidence-based
													interpretation
													of citizen
													signals and
													mapped
													infrastructure.
													It is not a
													final
													government
													decision.
												</div>
											</div>
										</div>
									</div>

									<div className="panel">
										<div className="panel-heading">
											<div>
												<div className="section-kicker">
													CITIZEN
													EVIDENCE
												</div>

												<h2>
													Requests
													from{" "}
													{
														selectedArea
													}
												</h2>
											</div>
										</div>

										<div className="request-evidence-list">
											
											{selectedAreaData.areaDemand.map(
												(item) => (
													<div
														className="evidence-item"
														key={`${item.location}-${item.demandGroup}-${item.requests?.[0]?.id || item.requestCount}`}
													>
														<div className="evidence-count">
															{
																item.requestCount
															}
														</div>

														<div>
															<strong>
																{
																	item.demandGroup
																}
															</strong>

															<p>
																{
																	item
																		.requests?.[0]
																		?.request
																}

																{item.requestCount >
																	1 &&
																	` + ${
																		item.requestCount -
																		1
																	} similar request${
																		item.requestCount -
																			1 ===
																		1
																			? ""
																			: "s"
																	}`}
															</p>
														</div>
													</div>
												)
											)}
										</div>
									</div>

									{areaInfrastructure && (
										<div className="panel">
											<div className="panel-heading">
												<div>
													<div className="section-kicker">
														MAPPED
														INFRASTRUCTURE
													</div>

													<h2>
														Nearby
														Facilities
													</h2>
												</div>
											</div>
<div className="facility-filters">
    <button
        className={facilityFilter === "healthcare" ? "active" : ""}
        onClick={() => setFacilityFilter("healthcare")}
    >
        Healthcare
        <span>
         {infrastructureLoading
        ? "—"
        : areaInfrastructure?.infrastructure?.counts?.healthcare ?? "—"}
        </span>
    </button>

    <button
        className={facilityFilter === "education" ? "active" : ""}
        onClick={() => setFacilityFilter("education")}
    >
        Education
        <span>
        {infrastructureLoading
        ? "—"
        : areaInfrastructure?.infrastructure?.counts?.education ?? "—"}
        </span>
    </button>

    <button
        className={facilityFilter === "transport" ? "active" : ""}
        onClick={() => setFacilityFilter("transport")}
    >
        Transport
        <span>
        {infrastructureLoading
        ? "—"
        : areaInfrastructure?.infrastructure?.counts?.transport ?? "—"}
        </span>
    </button>
</div>

<div className="request-evidence-list">
    {infrastructureLoading ? (
        <div className="infrastructure-loading">
    <div className="infrastructure-loading-dots">
        <span></span>
        <span></span>
        <span></span>
    </div>

    <div className="infrastructure-loading-title">
        Mapping nearby infrastructure...
    </div>

    <div className="infrastructure-loading-subtitle">
        Checking facilities within a 5 km radius
    </div>
</div>
    ) : areaInfrastructure?.infrastructure?.dataStatus ===
      "osm_unavailable" ? (
        <div className="insight-note">
            <span>!</span>
            <div>
                <strong>Infrastructure data unavailable</strong>
                <p>
                    OpenStreetMap could not be reached for this
                    area, so nearby facilities could not be
                    confirmed.
                </p>
            </div>
        </div>
    ) : areaInfrastructure?.infrastructure?.places?.length > 0 ? (
        areaInfrastructure.infrastructure.places
    .filter((place) => place.type === facilityFilter)
    .map((place, index) => (
                <div
                    className="evidence-item"
                    key={`${place.name}-${place.type}-${index}`}
                >
                    <div className="evidence-count">
                        {place.type === "healthcare"
                            ? "H"
                            : place.type === "education"
                            ? "E"
                            : "T"}
                    </div>

                    <div>
                        <strong>
                          {place.name || place.subtype || "Facility"}
                        </strong>

                        <p>
                             {place.subtype ||
                               (place.type === "healthcare"
                                      ? "Healthcare facility"
                                     : place.type === "education"
                                     ? "Education facility"
                                      : "Transport facility")}

                            {!place.name && (
                                 <span>
                                     {" "}· Name not listed in OpenStreetMap
                                 </span>
                             )}
                        </p>
						
                    </div>
                </div>
            ))
    ) : (
        <div className="insight-note">
            <span>i</span>
            <div>
                <strong>No mapped facilities found</strong>
                <p>
                    No matching facilities were returned within
                    the 5 km mapped area.
                </p>
            </div>
        </div>
    )}
</div>

											<div className="insight-note">
												<span>i</span>

												<div>
													Facility data
													is mapped
													from
													OpenStreetMap
													within a 5 km
													radius. It
													may not
													represent a
													complete
													inventory of
													all existing
													infrastructure.
												</div>
											</div>
										</div>
									)}
								</>
							)}
						</section>
					)}

					{/* AI RECOMMENDATIONS */}

					{currentPage === "AI Recommendations" && (
						<section className="page-section">
							<div className="section-kicker">
								AI-POWERED DECISION SUPPORT
							</div>

							<h1>AI Recommendations</h1>

							<p className="page-description">
								SutrAI analyzes recurring
								citizen demand signals and
								generates explainable
								development priorities for
								further investigation.
							</p>

							{recommendationsLoading && (
								<div className="panel recommendation-loading">
									<div className="recommendation-loader">
										<span></span>
										<span></span>
										<span></span>
									</div>

									<div>
										<strong>
											Analyzing
											development
											demand...
										</strong>

										<p>
											Gemini is
											examining
											aggregated
											citizen
											signals.
										</p>
									</div>
								</div>
							)}

							{recommendationsError && (
								<div className="panel recommendation-error">
									<strong>
										AI analysis
										unavailable
									</strong>

									<p>
										{
											recommendationsError
										}
									</p>

									<button
										className="outline-button"
										onClick={() =>
											setCurrentPage(
												"Overview"
											)
										}
									>
										Return to Overview
									</button>
								</div>
							)}

							{!recommendationsLoading &&
								!recommendationsError &&
								recommendations.length >
									0 && (
									<div className="recommendation-list">
										{recommendations.map(
											(
												item,
												index
											) => (
												<div
													className="recommendation-card"
													key={`${item.location}-${item.developmentArea}-${index}`}
												>
													<div className="recommendation-header">
														<div className="recommendation-rank">
															0
															{index +
																1}
														</div>

														<div className="recommendation-title">
															<div className="recommendation-location">
																{
																	item.location
																}
															</div>

															<h2>
																{
																	item.developmentArea
																}
															</h2>
														</div>

														<div
															className={`priority-badge ${
																item.priority
																	?.toLowerCase()
																	.includes(
																		"high"
																	)
																	? "high"
																	: "medium"
															}`}
														>
															{item.priority ||
																"Review"}
														</div>
													</div>

													<div className="recommendation-body">
														<div className="recommendation-signal">
															<span>
																Citizen
																signal
															</span>

															<strong>
																{
																	item.requestCount
																}{" "}
																request
																{item.requestCount ===
																1
																	? ""
																	: "s"}
															</strong>
														</div>
<div className="recommendation-evidence">
	<div className="section-kicker">
		EVIDENCE CONSIDERED
	</div>

	<div className="evidence-row">
		<div>
			<span>Citizen demand</span>
			<strong>
				{item.requestCount} signals
			</strong>
		</div>

		<div>
			<span>Mapped infrastructure</span>
			<strong>
				{item.infrastructureEvidence?.count ??
					"Unavailable"}
				{item.infrastructureEvidence?.count !==
					null &&
				item.infrastructureEvidence?.count !==
					undefined
					? ` ${item.infrastructureEvidence.label}`
					: ""}
			</strong>
		</div>

		<div>
			<span>Analysis radius</span>
			<strong>
				{item.infrastructureEvidence?.radius
					? `${Math.round(
							item.infrastructureEvidence.radius /
								1000
						)} km`
					: "—"}
			</strong>
		</div>
	</div>

	{item.infrastructureEvidence?.count !== null &&
		item.infrastructureEvidence?.count !==
			undefined && (
			<p className="evidence-source">
				Infrastructure evidence sourced from{" "}
				{item.infrastructureEvidence.source}.
			</p>
		)}
		<p className="evidence-note">
          These signals support further investigation; they do not represent a final infrastructure decision.
        </p>
                                                    </div>
														<div className="recommendation-reason">
															<div className="section-kicker">
																WHY
																THIS
																MATTERS
															</div>

															<p>
																{
																	item.reason
																}
															</p>
														</div>

														<div className="recommendation-action">
															<div>
																<div className="section-kicker">
																	SUGGESTED
																	NEXT
																	STEP
																</div>

																<p>
																	{
																		item.suggestedAction
																	}
																</p>
															</div>

															<span className="action-arrow">
																→
															</span>
														</div>
													</div>
												</div>
											)
										)}
									</div>
								)}

							{!recommendationsLoading &&
								!recommendationsError &&
								recommendations.length ===
									0 && (
									<div className="panel empty-recommendations">
										<div className="empty-recommendation-icon">
											✦
										</div>

										<h2>
											No
											recommendations
											yet
										</h2>

										<p>
											Submit more
											citizen
											development
											requests to
											generate
											meaningful
											demand-based
											recommendations.
										</p>
									</div>
								)}

							<div className="recommendation-disclaimer">
								<span>i</span>

								<p>
									AI recommendations are
									decision-support signals
									based on submitted citizen
									demand. They do not
									represent a final
									government decision or
									confirmed infrastructure
									requirement.
								</p>
							</div>
						</section>
					)}
				</main>
			</div>
		</div>
	);
}

export default App;
