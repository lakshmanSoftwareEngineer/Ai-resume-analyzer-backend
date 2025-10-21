import express from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import cors from "cors"
// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const app = express();
// Initialize the Gemini AI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});
app.use(cors())

// --- Multer Setup for File Upload ---
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  },
});

// Define the required output structure (JSON Schema)
const resumeAnalysisSchema = {
  type: "OBJECT",
  properties: {
    ats_score: {
      type: "NUMBER",
      description: "The Applicant Tracking System (ATS) compatibility score as a number between 0 and 100, where 100 is perfect compatibility."
    },
    structure: { 
      type: "STRING", 
      description: "An evaluation of the resume's logical organization (e.g., clarity of sections, flow, use of headers)." 
    },
    format: { 
      type: "STRING", 
      description: "A critique of the visual presentation, layout, and readability (e.g., font choice, white space, consistency)." 
    },
    keywords: { 
      type: "ARRAY", 
      description: "A list of the top 5-10 relevant technical and soft skills/keywords found in the resume.",
      items: { type: "STRING" }
    },
    suggestions: { 
      type: "ARRAY", 
      description: "Specific, actionable, and prioritized suggestions for improving the resume's content and presentation.",
      items: { type: "STRING" }
    }
  },
  // Ensure the fields appear in a consistent order, with ATS score first
  propertyOrdering: ["ats_score", "structure", "format", "keywords", "suggestions"]
};


// --- API Route Handler ---
app.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // 1. Extract text from PDF using the buffer
    const buffer = req.file.buffer;
    console.log(`Received file buffer of size: ${buffer.length} bytes`);
    
    // This is the correct class constructor pattern that resolves the previous error.
    const parser = new PDFParse({ data: buffer });
    const pdfData = await parser.getText();
    const resumeText = (pdfData.text || "").trim();
    
    if (!resumeText)
      return res.status(400).json({
        error: "No readable text found in PDF (the file might be an image scan).",
      });
      
    console.log("Extracted Text:\n", resumeText+ "...");


    // 2. Call the Gemini API for structured analysis
    const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            // The prompt contains only the extracted text
            { role: "user", parts: [{ text: resumeText }] }
        ],
        config: {
            // Updated system instruction to explicitly ask for the ATS score calculation
            systemInstruction: `You are an expert resume analyzer. Evaluate the provided resume text for structure, formatting, and relevant keywords. Crucially, calculate an Applicant Tracking System (ATS) compatibility score out of 100 based on the resume's clarity, sectioning, keyword density, and formatting. You MUST return your entire response as a single, valid JSON object strictly adhering to the defined schema. Do NOT include any introductory, explanatory, or concluding text outside of the JSON.`,
            
            // Configuration to force the model to output valid JSON
            responseMimeType: "application/json",
            responseSchema: resumeAnalysisSchema
        }
    });

    // 3. Process the Gemini response
    // The response.text property contains the guaranteed JSON string
    const jsonResponse = completion.text;
    
    // Parse the JSON string into a JavaScript object
    const analysis = JSON.parse(jsonResponse);
      console.log(analysis);
      
    // Send the structured analysis back to the client
    res.status(200).json({ analysis });

  } catch (error) {
    console.error("Error analyzing PDF:", error);
    // Be careful not to expose internal system error details in a production environment
    res.status(500).json({ error: error.message || "An internal server error occurred during analysis." });
  }
});


// --- Server Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
