import { useEffect, useRef, useState } from "react";
import "./CitizenInput.css";

const API_BASE = "https://sutrai-backend.onrender.com";

const languages = [
	"English",
	"Hindi",
	"Marathi",
	"Gujarati",
	"Tamil",
	"Telugu",
	"Bengali",
];

const categories = [
	"Auto-detect",
	"Roads & Connectivity",
	"Water",
	"Healthcare",
	"Education",
	"Waste Management",
	"Public Transport",
	"Electricity",
	"Other",
];

function CitizenInput() {
	const [formData, setFormData] = useState({
		request: "",
		location: "",
		area: "",
		language: "English",
		category: "Auto-detect",
	});

	const [analysis, setAnalysis] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef(null);

   useEffect(() => {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        setIsListening(true);
        setError("");
    };

    recognition.onresult = (event) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;

            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        if (finalTranscript) {
            setFormData((currentData) => ({
                ...currentData,
                request: `${currentData.request} ${finalTranscript}`.trim(),
            }));
        }

        console.log("Speech:", finalTranscript || interimTranscript);
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);

        if (event.error === "not-allowed") {
            setError(
                "Microphone permission was denied. Please allow microphone access."
            );
        } else if (event.error !== "aborted") {
            setError("Speech recognition stopped. Please try again.");
        }

        setIsListening(false);
    };

    recognition.onend = () => {
        setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
        recognition.stop();
        recognitionRef.current = null;
    };
}, []);

function toggleSpeechRecognition() {
    const recognition = recognitionRef.current;

    if (!recognition) {
        setError(
            "Speech-to-text is not supported in this browser. Please use Google Chrome."
        );
        return;
    }

    if (isListening) {
        recognition.stop();
        setIsListening(false);
        return;
    }

    try {
        recognition.lang =
            formData.language === "Hindi"
                ? "hi-IN"
                : formData.language === "Marathi"
                ? "mr-IN"
                : formData.language === "Gujarati"
                ? "gu-IN"
                : formData.language === "Tamil"
                ? "ta-IN"
                : formData.language === "Telugu"
                ? "te-IN"
                : formData.language === "Bengali"
                ? "bn-IN"
                : "en-IN";

        recognition.start();
    } catch (error) {
        console.error("Could not start speech recognition:", error);
        setIsListening(false);
    }
}

	function handleChange(event) {
		const { name, value } = event.target;

		setFormData((currentData) => ({
			...currentData,
			[name]: value,
		}));
	}

	function normalizeAnalysis(rawAnalysis) {
		if (!rawAnalysis) {
			return {
				summary: "No analysis was returned by the AI.",
			};
		}

		// Already an object
		if (typeof rawAnalysis === "object") {
			return rawAnalysis;
		}

		// String returned by backend
		if (typeof rawAnalysis === "string") {
			const cleaned = rawAnalysis
				.trim()
				.replace(/^```json\s*/i, "")
				.replace(/^```\s*/i, "")
				.replace(/\s*```$/i, "")
				.trim();

			try {
				const parsed = JSON.parse(cleaned);

				if (parsed && typeof parsed === "object") {
					return parsed;
				}
			} catch {
				// Keep the plain text as the summary.
			}

			return {
				summary: cleaned,
			};
		}

		return {
			summary: String(rawAnalysis),
		};
	}

	async function handleSubmit(event) {
		event.preventDefault();

		setLoading(true);
		setError("");
		setAnalysis(null);

		if (!formData.request.trim()) {
			setError("Please describe what your area needs.");
			setLoading(false);
			return;
		}

		if (!formData.location.trim()) {
			setError("Please enter your city or town.");
			setLoading(false);
			return;
		}

		if (!formData.area.trim()) {
			setError("Please enter your area or locality.");
			setLoading(false);
			return;
		}

		try {
			const response = await fetch(
				`${API_BASE}/api/analyze-request`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						request: formData.request.trim(),
						location: formData.location.trim(),
						area: formData.area.trim(),
						language: formData.language,
						category: formData.category,
					}),
				}
			);

			let data;

			try {
				data = await response.json();
			} catch {
				throw new Error(
					`Backend returned an invalid response (HTTP ${response.status}).`
				);
			}

			console.log("SutrAI AI Analysis Response:", data);

			if (!response.ok || data.success === false) {
				throw new Error(
					data.message ||
						data.error ||
						`AI analysis failed (HTTP ${response.status}).`
				);
			}

			const rawAnalysis =
				data.analysis ??
				data.result ??
				data.response ??
				data;

			const parsedAnalysis = normalizeAnalysis(rawAnalysis);

			setAnalysis(parsedAnalysis);
		} catch (error) {
			console.error("SutrAI Citizen Input Error:", error);

			setError(
				error?.message ||
					"AI analysis failed. Please make sure the backend is running."
			);
		} finally {
			setLoading(false);
		}
	}

	return (
		<main className="citizen-input-page">
			<section
				className="citizen-input-card"
				aria-labelledby="citizen-input-heading"
			>
				<div className="citizen-input-intro">
					<p className="citizen-input-eyebrow">
						CITIZEN VOICE
					</p>

					<h1 id="citizen-input-heading">
						Tell us what your area needs
					</h1>

					<p>
						Describe a development or public-service need in your
						own words. Your input helps build a clearer picture of
						what matters locally.
					</p>
				</div>

				<form
					className="citizen-input-form"
					onSubmit={handleSubmit}
				>
					<div className="citizen-input-field citizen-input-field-full">
						<label htmlFor="request">
							What does your area need?
						</label>
						

						<textarea
							id="request"
							name="request"
							value={formData.request}
							onChange={handleChange}
							placeholder="Example: Our village has very limited bus connectivity..."
							rows="7"
							required
						/>


<button
    type="button"
    className={`speech-button ${
        isListening ? "listening" : ""
    }`}
    onClick={toggleSpeechRecognition}
    aria-label={
        isListening
            ? "Stop voice input"
            : "Start voice input"
    }
>
    {isListening ? "🔴 Stop listening" : "🎙️ Speak"}
</button>


					</div>

					<div className="citizen-input-field citizen-input-field-full">
						<label htmlFor="location">
							City / Town
						</label>

						<input
							id="location"
							name="location"
							type="text"
							value={formData.location}
							onChange={handleChange}
							placeholder="Example: Thane"
							required
						/>

						<small>
							Enter the city or town first. SutrAI will use your
							specific area for the 5 km local analysis.
						</small>
					</div>

					<div className="citizen-input-field citizen-input-field-full">
						<label htmlFor="area">
							Area / Locality
						</label>

						<input
							id="area"
							name="area"
							type="text"
							value={formData.area}
							onChange={handleChange}
							placeholder="Example: Naupada, Wagle Estate, Manpada..."
							required
						/>
					</div>

					<div className="citizen-input-field">
						<label htmlFor="language">
							Language
						</label>

						<select
							id="language"
							name="language"
							value={formData.language}
							onChange={handleChange}
						>
							{languages.map((language) => (
								<option
									key={language}
									value={language}
								>
									{language}
								</option>
							))}
						</select>
					</div>

					<div className="citizen-input-field">
						<label htmlFor="category">
							Category
						</label>

						<select
							id="category"
							name="category"
							value={formData.category}
							onChange={handleChange}
						>
							{categories.map((category) => (
								<option
									key={category}
									value={category}
								>
									{category}
								</option>
							))}
						</select>
					</div>

					<button
						className="analyze-button"
						type="submit"
						disabled={loading}
					>
						{loading
							? "Analyzing..."
							: "Analyze with AI"}

						{!loading && (
							<span aria-hidden="true">
								→
							</span>
						)}
					</button>

					<p className="citizen-input-help">
						Your input helps SutrAI understand community
						development needs.
					</p>
				</form>

				{error && (
					<div className="ai-error">
						{error}
					</div>
				)}

				{analysis && (
					<section className="ai-analysis-card">
						<div className="ai-analysis-header">
							<div>
								<p className="citizen-input-eyebrow">
									SUTRAI AI ANALYSIS
								</p>

								<h2>
									Development Need Identified
								</h2>
							</div>

							<span className="ai-status">
								AI Analyzed
							</span>
						</div>

						<div className="ai-analysis-grid">
							<div className="ai-analysis-item">
								<span>Category</span>

								<strong>
									{analysis.category ||
										"Not identified"}
								</strong>
							</div>

							<div className="ai-analysis-item">
								<span>Development Need</span>

								<strong>
									{analysis.developmentNeed ||
										"Not identified"}
								</strong>
							</div>

							<div className="ai-analysis-item">
								<span>Urgency</span>

								<strong>
									{analysis.urgency ||
										"Not identified"}
								</strong>
							</div>

							<div className="ai-analysis-item">
								<span>Affected Area</span>

								<strong>
									{analysis.affectedArea ||
										`${formData.area}, ${formData.location}`}
								</strong>
							</div>
						</div>

						<div className="ai-analysis-section">
							<span>AI Summary</span>

							<p>
								{typeof analysis.summary ===
								"string"
									? analysis.summary
									: "No summary available."}
							</p>
						</div>

						<div className="ai-analysis-section">
							<span>Why this matters</span>

							<p>
								{typeof analysis.reasoning ===
								"string"
									? analysis.reasoning
									: "No reasoning available."}
							</p>
						</div>
					</section>
				)}
			</section>
		</main>
	);
}

export default CitizenInput;
