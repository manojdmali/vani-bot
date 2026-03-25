# Vani AI - Developer Documentation

Vani is a plug-and-play AI Voice Assistant with built-in RAG (Retrieval-Augmented Generation) and real-time audio capabilities.

## 1. Admin Access
You can access the Admin Control Center to configure voice, LLM, and knowledge base settings by appending `?admin=true` to your application URL.

**Admin URL:** `https://ais-dev-ftu3rp3k3xkkbhhvzjlau5-633762901669.asia-east1.run.app?admin=true`

## 2. Embedding as a Widget
You can embed Vani into any website using an `<iframe>`.

```html
<iframe 
  src="https://ais-dev-ftu3rp3k3xkkbhhvzjlau5-633762901669.asia-east1.run.app?widget=true" 
  width="400" 
  height="600" 
  frameborder="0" 
  style="border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);"
></iframe>
```

## 3. RAG & Knowledge Base
Vani features a dynamic, pluggable RAG system.
- **Multi-Source Ingestion**: Bulk upload multiple PDF documents in the **RAG Infrastructure** tab.
- **Advanced Processing**: Configure chunk size and overlap to optimize context retrieval accuracy.
- **Pluggable Vector Storage**: Choose between Firestore (default), ChromaDB, Qdrant, or Milvus.
- **Customizable Infrastructure**: Define database endpoints and embedding models (e.g., `gemini-embedding-2-preview`).
- **Search Grounding**: Toggle Google Search grounding in the **AI Configuration** tab for real-time web context.
- **Manual Entry**: Add text-based documents directly via the **Knowledge Base** tab.

## 4. AI Configuration
Vani supports multiple AI backends:
- **Google Gemini:** Native low-latency audio support (Recommended).
- **Ollama:** For local LLM hosting.
- **Grok (xAI):** High-performance reasoning.
- **OpenAI:** Industry standard LLM.

Configure your API keys and model names in the **AI Configuration** tab.

## 5. Customization
- **Voice:** Choose from multiple Indian voice profiles (Vani, Asha, Arjun, etc.) with regional accents.
- **Theme:** Customize primary, secondary, and background colors to match your brand.
- **System Instructions:** Define the AI's personality and behavior globally.

## 6. Multi-Project Reuse
Since all configurations are stored in a global Firestore document, you can reuse the same backend across multiple projects by simply embedding the widget URL. Any changes made in the Admin Panel will reflect across all instances instantly.
