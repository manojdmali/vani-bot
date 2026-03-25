import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Multer setup for PDF uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(express.json({ limit: '50mb' }));

// Gemini setup for embeddings
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Chunking Logic
function chunkText(text: string, size: number, overlap: number) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.substring(start, end));
    start += size - overlap;
  }
  return chunks;
}

// Vector DB Integration
async function pushToVectorDB(chunks: string[], config: any) {
  const { provider, endpoint, collection, embeddingModel } = config;
  
  // 1. Generate Embeddings
  const embeddings = await Promise.all(chunks.map(async (chunk) => {
    const result = await genAI.models.embedContent({
      model: embeddingModel || 'gemini-embedding-2-preview',
      contents: [chunk],
    });
    return result.embeddings[0].values;
  }));

  // 2. Push to Provider
  switch (provider) {
    case 'chroma':
      await axios.post(`${endpoint}/api/v1/collections/${collection}/add`, {
        documents: chunks,
        embeddings: embeddings,
        ids: chunks.map((_, i) => `chunk_${Date.now()}_${i}`),
      });
      break;
    case 'qdrant':
      await axios.put(`${endpoint}/collections/${collection}/points`, {
        points: chunks.map((chunk, i) => ({
          id: i,
          vector: embeddings[i],
          payload: { text: chunk }
        }))
      });
      break;
    case 'milvus':
      // Milvus usually requires a more complex setup with their SDK
      // For now, we'll simulate or use their REST API if available
      break;
    default:
      console.log('No vector DB provider configured, falling back to Firestore simulation');
  }
}

// API Routes
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    const config = JSON.parse(req.body.config || '{}');
    const { chunkSize = 1000, overlap = 200 } = config;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const allChunks: string[] = [];
    for (const file of files) {
      const data = await pdf(file.buffer);
      const chunks = chunkText(data.text, chunkSize, overlap);
      allChunks.push(...chunks);
    }

    // Push to Vector DB if configured
    if (config.provider && config.endpoint) {
      await pushToVectorDB(allChunks, config);
    }

    res.json({ 
      success: true, 
      message: `Processed ${files.length} files into ${allChunks.length} chunks.`,
      chunks: allChunks 
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
