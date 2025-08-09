// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = 3001; // Port for our backend server

// --- MIDDLEWARE ---
app.use(cors()); // Allow requests from our frontend
app.use(express.json());

// Setup multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- HELPER FUNCTIONS ---

// Function to extract text from a buffer (PDF or DOCX)
const extractText = async (buffer, mimetype) => {
  if (mimetype === "application/pdf") {
    const data = await pdf(buffer);
    return data.text;
  } else if (
    mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error("Unsupported file type");
};

// Simple keyword analysis function
const analyzeTexts = (resumeText, jobDescText) => {
  const cleanText = (text) =>
    text
      .toLowerCase()
      .replace(/[^\w\s]/gi, "")
      .split(/\s+/);

  const resumeWords = new Set(cleanText(resumeText));
  const jobDescWords = new Set(cleanText(jobDescText));

  const matchingKeywords = [...resumeWords].filter((word) =>
    jobDescWords.has(word)
  );
  const missingKeywords = [...jobDescWords].filter(
    (word) => !resumeWords.has(word)
  );

  // Avoid division by zero
  const score =
    jobDescWords.size > 0
      ? (matchingKeywords.length / jobDescWords.size) * 100
      : 0;

  return {
    score: Math.round(score),
    matchingKeywords,
    missingKeywords: missingKeywords.slice(0, 20), // Limit for brevity
  };
};

// --- API ROUTE ---
// In backend/index.js

// --- API ROUTE (IMPROVED LOGGING) ---
app.post("/api/analyze", upload.single("resume"), async (req, res) => {
  // Add a log to see when a request starts
  console.log("Received /api/analyze request");

  try {
    if (!req.file) {
      console.log("Error: No resume file uploaded.");
      return res.status(400).json({ error: "No resume file uploaded." });
    }

    const resumeBuffer = req.file.buffer;
    const jobDescription = req.body.jobDescription;

    if (!jobDescription) {
      console.log("Error: No job description provided.");
      return res.status(400).json({ error: "No job description provided." });
    }

    // 1. Extract text from resume
    console.log("Step 1: Extracting text...");
    const resumeText = await extractText(resumeBuffer, req.file.mimetype);
    console.log("Text extracted successfully.");

    // 2. Perform keyword analysis
    console.log("Step 2: Analyzing keywords...");
    const analysis = analyzeTexts(resumeText, jobDescription);
    console.log(`Analysis complete. Score: ${analysis.score}%`);

    // 3. Get AI-powered suggestions
    console.log("Step 3: Calling Gemini API...");
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
    });
    const prompt = `You are an expert career coach. A user has provided their resume and a job description. The analysis found these missing keywords: ${analysis.missingKeywords.join(
      ", "
    )}. Based on the resume text and the job description, suggest three specific, actionable improvements to the resume's bullet points to better align with the job description. Do not just list the keywords. Provide concrete, rephrased bullet points.
        ---
        RESUME TEXT:
        ${resumeText.substring(0, 2000)}
        ---
        JOB DESCRIPTION:
        ${jobDescription.substring(0, 2000)}`;

    // Log the prompt for debugging if needed
    // console.log('--- PROMPT ---', prompt);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiSuggestions = response.text();
    console.log("Gemini API call successful.");

    // 4. Send back the complete result
    res.json({
      score: analysis.score,
      missingKeywords: analysis.missingKeywords,
      suggestions: aiSuggestions,
    });
  } catch (error) {
    // THIS IS THE MOST IMPORTANT PART FOR DEBUGGING
    console.error("🔥🔥🔥 An error occurred in /api/analyze: 🔥🔥🔥");
    console.error(error); // Log the full error object
    res.status(500).json({
      error: "An error occurred during analysis.",
      details: error.message,
    });
  }
});
// --- START SERVER ---
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
