import {
	MapContainer,
	TileLayer,
	CircleMarker,
	Popup,
	Tooltip,
	useMap,
} from "react-leaflet";
import { useEffect, useMemo } from "react";
import "leaflet/dist/leaflet.css";

function MapViewController({ locations }) {
	const map = useMap();

	useEffect(() => {
		if (!locations.length) return;

		const bounds = locations.map((item) => [
			item.coordinates.latitude,
			item.coordinates.longitude,
		]);

		map.fitBounds(bounds, {
			padding: [50, 50],
			maxZoom: 11,
		});
	}, [locations, map]);

	return null;
}

function DevelopmentMap({ demand = [] }) {
	const locationGroups = useMemo(() => {
		const groups = {};

		for (const item of demand) {
			if (!item.coordinates) continue;

			const latitude = Number(item.coordinates.latitude);
const longitude = Number(item.coordinates.longitude);

if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    continue;
}

const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

if (!groups[key]) {
    groups[key] = {
        location: item.location,
        coordinates: {
            latitude,
            longitude,
        },
        totalRequests: 0,
        demands: [],
    };
}

			groups[key].totalRequests += item.requestCount;

			groups[key].demands.push({
				demandGroup: item.demandGroup,
				requestCount: item.requestCount,
			});
		}

		return Object.values(groups);
	}, [demand]);

	const defaultCenter = [19.1666, 73.2389];

	return (
		<div
			style={{
				width: "100%",
				height: "560px",
				borderRadius: "20px",
				overflow: "hidden",
				position: "relative",
			}}
		>

<div 
	style={{
		position: "absolute",
		top: "16px",
		right: "16px",
		zIndex: 2000,
		background: "rgba(255, 255, 255, 0.95)",
		borderRadius: "12px",
		padding: "12px 14px",
		boxShadow: "0 4px 14px rgba(0, 0, 0, 0.12)",
		fontSize: "12px",
	}}
>
	<strong
		style={{
			display: "block",
			marginBottom: "8px",
			fontSize: "13px",
		}}
	>
		Citizen demand intensity
	</strong>

	<div
		style={{
			display: "flex",
			position: "relative",
			alignItems: "center",
			gap: "8px",
			marginBottom: "6px",
		}}
	>
		<span
			style={{
				width: "8px",
				height: "8px",
				borderRadius: "50%",
				border: "2.2px solid #6b0f0f",
				background: "rgba(15, 107, 87, 0.2)",
				display: "inline-block",
			}}
		/>
		<span>Lower</span>
	</div>

	<div
		style={{
			display: "flex",
			alignItems: "center",
			gap: "8px",
			marginBottom: "6px",
		}}
	>
		<span
			style={{
				width: "12px",
				height: "12px",
				borderRadius: "50%",
				border: "2.2px solid #6b0f0f",
				background: "rgba(15, 107, 87, 0.2)",
				display: "inline-block",
			}}
		/>
		<span>Medium</span>
	</div>

	<div
		style={{
			display: "flex",
			alignItems: "center",
			gap: "8px",
		}}
	>
		<span
			style={{
				width: "17px",
				height: "17px",
				borderRadius: "50%",
				border: "2.2px solid #6b0f0f",
				background: "rgba(15, 107, 87, 0.2)",
				display: "inline-block",
			}}
		/>
		<span>Higher</span>
	</div>
</div>

			<MapContainer
				center={defaultCenter}
				zoom={11}
				style={{
					width: "100%",
					height: "100%",
				    position: "relative",
                    zIndex: 0,
				}}
			>
				<TileLayer
					attribution="&copy; OpenStreetMap contributors"
					url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
				/>

				<MapViewController locations={locationGroups} />

				{locationGroups.map((item) => {
					const radius = Math.min(
						5 + item.totalRequests * 3,
						28
					);

					return (
						<CircleMarker
	key={item.location}
	center={[
		item.coordinates.latitude,
		item.coordinates.longitude,
	]}
	radius={radius}
	pathOptions={{
		color: "#6b0f0f",
		fillColor: "#b4250e",
		fillOpacity: 0.22,
		weight: 3,
	}}
>
<Tooltip
	direction="top"
	offset={[0, -10]}
	permanent
>
	<div
		style={{
			textAlign: "center",
			fontWeight: "700",
			fontSize: "13px",
			lineHeight: "1.2",
			padding: "2px 2px",
		}}
	>
		<div>{item.location}</div>

		<div
			style={{
				fontSize: "12px",
				fontWeight: "600",
				marginTop: "2px",
				opacity: 0.8,
			}}
		>
			{item.totalRequests} demand signals
		</div>
	</div>
</Tooltip>
							<Popup>
								<div
									style={{
										minWidth: "190px",
									}}
								>
									<strong
										style={{
											fontSize: "16px",
										}}
									>
										{item.location}
									</strong>

									<div
										style={{
											marginTop: "6px",
											marginBottom: "10px",
										}}
									>
										<b>{item.totalRequests}</b>{" "}
										citizen demand signals
									</div>

									{item.demands.map((demandItem) => (
										<div
											key={demandItem.demandGroup}
											style={{
												display: "flex",
												justifyContent:
													"space-between",
												gap: "12px",
												marginBottom: "5px",
											}}
										>
											<span>
												{demandItem.demandGroup}
											</span>

											<strong>
												{demandItem.requestCount}
											</strong>
										</div>
									))}
								</div>
							</Popup>
						</CircleMarker>
					);
				})}
			</MapContainer>
		</div>
	);
}

export default DevelopmentMap;