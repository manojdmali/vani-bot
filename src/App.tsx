import React, { useState, useEffect, useRef } from 'react';
import { auth, db, getKnowledgeBase, getGlobalSettings } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { GeminiVoiceAgent } from './lib/gemini';
import { Mic, MicOff, Book, Send, LogIn, LogOut, Settings, MessageSquare, Plus, Trash2, X, Shield, Save, Palette, Globe, Languages, Heart, History, Home, User as UserIcon, ChevronDown, Upload, Database, FileText, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = 'Something went wrong.';
      try {
        const parsedError = JSON.parse(this.state.error?.message || '');
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} during ${parsedError.operationType} on ${parsedError.path}`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-[#0a0502] flex items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <X className="w-10 h-10 text-red-500" />
            </div>
            <h1 className="text-3xl font-serif italic text-white">Oops! An error occurred</h1>
            <p className="text-[#e0d8d0]/60 leading-relaxed">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-sm font-medium"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const DEFAULT_LANGUAGES = [
  { name: 'English', code: 'en' },
  { name: 'Hindi (हिन्दी)', code: 'hi' },
  { name: 'Marathi (मराठी)', code: 'mr' },
  { name: 'Tamil (தமிழ்)', code: 'ta' },
  { name: 'Telugu (తెలుగు)', code: 'te' },
  { name: 'Bengali (বাংলা)', code: 'bn' },
  { name: 'Gujarati (ગુજરાતી)', code: 'gu' },
  { name: 'Kannada (કನ್ನಡ)', code: 'kn' },
  { name: 'Malayalam (മലયාලം)', code: 'ml' },
  { name: 'Punjabi (ਪੰਜਾਬી)', code: 'pa' },
];

const DEFAULT_SETTINGS = {
  appName: 'Vani',
  logoUrl: '',
  primaryColor: '#ff4e00',
  secondaryColor: '#3a1510',
  backgroundColor: '#0a0502',
  languages: DEFAULT_LANGUAGES,
  aiProvider: 'gemini', // 'gemini', 'ollama', 'grok', 'openai'
  modelName: 'gemini-2.5-flash-native-audio-preview-12-2025',
  apiUrl: '',
  apiKey: '',
  systemInstruction: `You are Vani, a warm, polite, and helpful Indian Voice Assistant. 
Your goal is to provide natural, human-like conversation that feels like talking to a real person.

EMOTIONAL INTELLIGENCE & STYLE:
- Be expressive and empathetic. Don't sound like a robot.
- Use natural pauses and intonations.
- If the user is happy, sound excited; if they are concerned, sound empathetic and calm.
- Avoid generic "AI" phrasing. Speak like a real person who is genuinely interested in helping.

VOICE-ONLY RULES:
1. NEVER use markdown formatting (no asterisks, hashtags, or bullet points). 
2. NEVER narrate your internal process or "think out loud" (e.g., avoid saying "I am searching for..." or "Let me outline that...").
3. Respond directly and immediately to the user's request.
4. Use a respectful tone. In Hindi or Indian contexts, use "Ji" and "Aap" naturally.
5. Keep responses concise and easy to follow by ear.
6. Use natural conversational fillers like "Hmm", "I see", or "Alright" to sound more human.
7. If the user asks for a list, present it as a natural spoken sequence, not a formatted list.`,
  chunkSize: 1000,
  overlap: 200,
  vectorProvider: 'firestore', // 'firestore', 'chroma', 'qdrant', 'milvus'
  vectorEndpoint: '',
  vectorCollection: 'knowledge',
  embeddingModel: 'gemini-embedding-2-preview',
  searchGrounding: false,
};

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [lastMessage, setLastMessage] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant', text: string, timestamp: number }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showAdmin, setShowAdmin] = useState(false);
  const [selectedLang, setSelectedLang] = useState(DEFAULT_LANGUAGES[0]);

  // Handle Admin URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === 'true' || window.location.pathname === '/admin') {
      setShowAdmin(true);
    }
  }, []);
  const [loading, setLoading] = useState(true);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState({
    voiceName: 'Vani',
    gender: 'Female',
    accent: 'Neutral Indian',
    speed: 'Normal',
    pitch: 'Normal',
    emotionalStyle: 'Friendly'
  });
  
  const agentRef = useRef<GeminiVoiceAgent | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        const userData = userDoc.data();
        setIsAdmin(userData?.role === 'admin' || u.email === 'developer.manoj9@gmail.com');
      } else {
        setIsAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as any;
        setSettings({ ...DEFAULT_SETTINGS, ...data });
        if (data.languages?.length > 0) {
          setSelectedLang(data.languages[0]);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'knowledge'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setKnowledge(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      toast.success('Logged in successfully');
    } catch (err) {
      toast.error('Login failed: ' + (err as Error).message);
    }
  };

  const handleLogout = () => auth.signOut();

  // Auto-restart agent when voice settings change
  useEffect(() => {
    if (isRecording) {
      const timer = setTimeout(() => {
        stopAgent();
        startAgent();
        toast.info('Applying new voice settings...');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [voiceSettings.voiceName, voiceSettings.accent, voiceSettings.emotionalStyle]);

  const startAgent = async () => {
    try {
      const kbContent = await getKnowledgeBase();
      const systemInstruction = `
        ${settings.systemInstruction}
        
        The user has selected ${selectedLang.name} as their preferred language. 
        Please respond primarily in ${selectedLang.name}, but feel free to use "Hinglish" (a mix of Hindi and English) if it feels more natural for the context.

        VOICE PERSONA & STYLE:
        - Accent: ${voiceSettings.accent}
        - Speaking Speed: ${voiceSettings.speed} (Adjust your delivery pace accordingly)
        - Pitch: ${voiceSettings.pitch} (Adjust your vocal tone accordingly)
        - Emotional Style: ${voiceSettings.emotionalStyle} (Adopt this personality trait throughout the conversation)

        KNOWLEDGE BASE CONTEXT (Use this information to answer accurately):
        ${kbContent || "No specific knowledge base content provided yet."}
      `;

      // Use configured API key or fallback to environment key
      const apiKey = settings.apiKey || process.env.GEMINI_API_KEY!;

      if (settings.aiProvider !== 'gemini') {
        toast.info(`Switching to ${settings.aiProvider} (${settings.modelName})...`);
        // Note: For non-gemini providers, we would ideally implement a separate pipeline.
        // For now, we'll keep using Gemini but warn the user if they've selected another provider
        // until the full multi-provider bridge is implemented.
      }

      agentRef.current = new GeminiVoiceAgent(
        apiKey,
        (msg) => {
          setLastMessage(msg);
          setHistory(prev => [...prev, { role: 'assistant', text: msg, timestamp: Date.now() }]);
        },
        (s) => setStatus(s)
      );

      const voiceMapping: Record<string, string> = {
        'Vani': 'Kore',
        'Asha': 'Zephyr',
        'Arjun': 'Puck',
        'Rohan': 'Charon',
        'Deepak': 'Fenrir',
      };

      const actualVoiceName = voiceMapping[voiceSettings.voiceName] || 'Kore';
      
      // Enhance system instruction with voice personality and Sarvam AI style cues
      const voicePersonality = `
        VOICE PERSONA:
        - You are currently speaking as "${voiceSettings.voiceName}" (${voiceSettings.gender}).
        - Your style is ${voiceSettings.emotionalStyle}.
        - Your accent is ${voiceSettings.accent}.
        
        CRITICAL VOICE INSTRUCTIONS:
        1. Mimic the natural cadence, warmth, and rhythm of a native Indian human speaker.
        2. If you are "Vani", sound like the Sarvam AI Vani voice: warm, helpful, and very natural.
        3. If you are "Arjun", use a deeper, more mature Indian male tone.
        4. Use appropriate Indian fillers like "achha", "theek hai", or "ji" sparingly to sound more human.
        5. Adjust your tone to be ${voiceSettings.emotionalStyle.toLowerCase()}.
        6. Keep responses brief to maintain a fluid voice conversation.
        7. IMPORTANT: Speak with a clear Indian English accent (or Hindi if spoken to in Hindi).
      `;
      
      const fullInstruction = `${systemInstruction}\n\n${voicePersonality}`;

      const tools: any[] = [];
      if (settings.searchGrounding) {
        tools.push({ googleSearch: {} });
      }

      await agentRef.current.connect(fullInstruction, actualVoiceName, tools);
      setIsRecording(true);
      toast.success('Voice agent started');
    } catch (err) {
      toast.error('Failed to start agent: ' + (err as Error).message);
    }
  };

  const stopAgent = () => {
    agentRef.current?.disconnect();
    agentRef.current = null;
    setIsRecording(false);
    setStatus('Idle');
    toast.info('Voice agent stopped');
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;

  return (
    <div 
      className="min-h-screen text-[#e0d8d0] font-sans selection:bg-white/30 transition-colors duration-700"
      style={{ backgroundColor: settings.backgroundColor }}
    >
      <Toaster position="top-center" theme="dark" />
      
      {/* Immersive Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-40 animate-pulse" 
          style={{ backgroundColor: settings.secondaryColor }}
        />
        <div 
          className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[150px] opacity-20" 
          style={{ backgroundColor: settings.primaryColor }}
        />
      </div>

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between p-4 sm:p-6 backdrop-blur-xl border-b border-white/5 sticky top-0">
        <div className="flex items-center gap-3">
          <div 
            className="w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: `linear-gradient(to tr, ${settings.primaryColor}, ${settings.secondaryColor})` }}
          >
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-xl font-serif italic tracking-tight hidden sm:block">{settings.appName}</h1>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Language Dropdown */}
          <div className="relative group">
            <button className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 transition-all">
              <Globe className="w-4 h-4 text-[#ff4e00]" />
              <span className="text-xs font-medium">{selectedLang.name.split(' ')[0]}</span>
              <ChevronDown className="w-3 h-3 opacity-40" />
            </button>
            <div className="absolute top-full right-0 mt-2 w-48 bg-[#151619] border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              {settings.languages.map(lang => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLang(lang)}
                  className={`w-full text-left px-4 py-3 text-xs hover:bg-white/5 transition-colors ${selectedLang.code === lang.code ? 'text-[#ff4e00] bg-white/5' : 'text-white/60'}`}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          </div>

          {/* Small Mic Status */}
          <div className={`p-2 rounded-full border transition-all ${isRecording ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
            <Mic className={`w-4 h-4 ${isRecording ? 'text-green-500' : 'text-white/20'}`} />
          </div>

          <div className="h-4 w-[1px] bg-white/10 mx-1" />

          <button 
            onClick={() => setShowVoiceSettings(true)}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <Settings className="w-5 h-5 text-white/60" />
          </button>

          {isAdmin && (
            <button 
              onClick={() => setShowAdmin(true)}
              className="p-2 hover:bg-white/5 rounded-full transition-colors"
            >
              <Shield className="w-5 h-5 text-yellow-500" />
            </button>
          )}

          {user ? (
            <button onClick={handleLogout} className="w-8 h-8 rounded-full overflow-hidden border border-white/10">
              <img src={user.photoURL || ''} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </button>
          ) : (
            <button onClick={handleLogin} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <LogIn className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto p-6 sm:p-8 pt-8 sm:pt-12 pb-32">
        <div className="flex flex-col items-center text-center space-y-8 sm:space-y-12">
          
          <div className="space-y-2">
            <h2 className="text-3xl sm:text-4xl font-serif italic">Namaste, I'm {settings.appName}</h2>
            <p className="text-[#e0d8d0]/40 text-sm sm:text-base">Your multilingual AI voice companion</p>
          </div>

          {/* Voice Wave Animation */}
          <div className="h-24 flex items-center justify-center">
            <VoiceWave active={isRecording && status === 'Connected'} />
          </div>

          {/* Mic Button */}
          <div className="relative group py-8">
            <AnimatePresence>
              {isRecording && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: [1, 1.8, 1], opacity: [0.2, 0.4, 0.2] }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 rounded-full blur-3xl"
                  style={{ backgroundColor: settings.primaryColor }}
                />
              )}
            </AnimatePresence>
            
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={isRecording ? stopAgent : startAgent}
              className={`relative z-10 w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl ${
                isRecording ? 'scale-110' : 'bg-white/5 hover:bg-white/10 border border-white/10'
              }`}
              style={isRecording ? { backgroundColor: settings.primaryColor, boxShadow: `0 0 60px ${settings.primaryColor}80` } : {}}
            >
              {isRecording ? (
                <div className="relative">
                  <MicOff className="w-16 h-16 text-white" />
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="absolute -inset-2 border-2 border-white/30 rounded-full"
                  />
                </div>
              ) : (
                <Mic className="w-16 h-16 text-white/40 group-hover:text-white/60 transition-colors" />
              )}
            </motion.button>
          </div>

          <div className="space-y-6 w-full max-w-2xl">
            <div className="flex items-center justify-center gap-3">
              <div 
                className={`w-3 h-3 rounded-full ${isRecording ? 'animate-pulse' : 'opacity-20'}`} 
                style={{ backgroundColor: isRecording ? '#22c55e' : '#fff' }}
              />
              <span className="text-sm font-mono uppercase tracking-[0.2em] opacity-40">{status}</span>
            </div>
            
            <AnimatePresence mode="wait">
              {lastMessage ? (
                <motion.div
                  key="message"
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  className="p-10 bg-white/5 backdrop-blur-2xl rounded-[40px] border border-white/10 shadow-2xl relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: settings.primaryColor }} />
                  <p className="text-2xl font-serif italic text-white/90 leading-relaxed">
                    "{lastMessage}"
                  </p>
                </motion.div>
              ) : isRecording && (
                <motion.div
                  key="listening"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-white/30 font-serif italic text-lg"
                >
                  I'm listening... speak naturally
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 p-4 sm:p-6 flex justify-center pointer-events-none">
        <div className="bg-[#151619]/80 backdrop-blur-2xl border border-white/10 rounded-full px-6 py-3 flex items-center gap-8 shadow-2xl pointer-events-auto">
          <button className="p-2 text-[#ff4e00] transition-transform active:scale-90">
            <Home className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setShowHistory(true)}
            className="p-2 text-white/40 hover:text-white transition-all active:scale-90"
          >
            <History className="w-6 h-6" />
          </button>
          <div className="w-[1px] h-6 bg-white/10" />
          <button 
            onClick={() => setShowVoiceSettings(true)}
            className="p-2 text-white/40 hover:text-white transition-all active:scale-90"
          >
            <Settings className="w-6 h-6" />
          </button>
          {user && (
            <button className="p-2 text-white/40 hover:text-white transition-all active:scale-90">
              <UserIcon className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      {/* History Panel */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowHistory(false)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-[#151619] w-full max-w-2xl rounded-t-[40px] border-t border-x border-white/10 flex flex-col max-h-[80vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/5 rounded-2xl">
                    <History className="w-6 h-6 text-[#ff4e00]" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-serif italic">Chat History</h2>
                    <p className="text-xs font-mono opacity-40 uppercase tracking-widest">Recent Voice Interactions</p>
                  </div>
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {history.length === 0 ? (
                  <div className="text-center py-20 opacity-20">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4" />
                    <p className="font-serif italic">No history yet...</p>
                  </div>
                ) : (
                  history.map((item, i) => (
                    <div key={i} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${item.role === 'user' ? 'bg-[#ff4e00] text-white rounded-tr-none' : 'bg-white/5 border border-white/10 text-white/80 rounded-tl-none'}`}>
                        {item.text}
                      </div>
                      <span className="text-[10px] font-mono opacity-20 mt-1 uppercase">
                        {item.role} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Settings Modal */}
      <AnimatePresence>
        {showVoiceSettings && (
          <VoiceSettingsModal 
            onClose={() => setShowVoiceSettings(false)} 
            settings={voiceSettings} 
            setSettings={setVoiceSettings} 
          />
        )}
      </AnimatePresence>

      {/* Admin Panel Modal */}
      <AnimatePresence>
        {showAdmin && (
          <AdminPanel 
            onClose={() => setShowAdmin(false)} 
            settings={settings} 
            knowledge={knowledge}
          />
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
      `}</style>
    </div>
  );
}

function VoiceWave({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-1 h-12">
      {[...Array(12)].map((_, i) => (
        <motion.div
          key={i}
          animate={active ? {
            height: [8, Math.random() * 40 + 10, 8],
            opacity: [0.3, 1, 0.3]
          } : {
            height: 4,
            opacity: 0.1
          }}
          transition={{
            duration: 0.5 + Math.random() * 0.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.05
          }}
          className="w-1.5 bg-[#ff4e00] rounded-full"
        />
      ))}
    </div>
  );
}

function VoiceSettingsModal({ onClose, settings, setSettings }: { onClose: () => void, settings: any, setSettings: (s: any) => void }) {
  const [genderFilter, setGenderFilter] = useState<'All' | 'Male' | 'Female'>('All');
  const voices = [
    { id: 'Vani', label: 'Vani (Premium)', gender: 'Female', best: true, description: 'Sarvam AI style - Warm & Natural' },
    { id: 'Asha', label: 'Asha', gender: 'Female', description: 'Clear & Professional' },
    { id: 'Arjun', label: 'Arjun', gender: 'Male', description: 'Deep & Authoritative' },
    { id: 'Rohan', label: 'Rohan', gender: 'Male', description: 'Young & Energetic' },
    { id: 'Deepak', label: 'Deepak', gender: 'Male', description: 'Mature & Calm' },
  ];
  const emotionalStyles = ['Empathetic', 'Energetic', 'Professional', 'Casual', 'Friendly'];

  const filteredVoices = voices.filter(v => genderFilter === 'All' || v.gender === genderFilter);
  const accents = ['Neutral Indian', 'North Indian', 'South Indian', 'Bengali', 'Marathi', 'Punjabi'];
  const speeds = ['Slow', 'Normal', 'Fast'];
  const pitches = ['Low', 'Normal', 'High'];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-[#151619] w-full max-w-md rounded-[40px] border border-white/10 overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between p-8 border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/5 rounded-2xl">
              <Settings className="w-6 h-6 text-white/60" />
            </div>
            <div>
              <h2 className="text-2xl font-serif italic">Voice Settings</h2>
              <p className="text-xs font-mono opacity-40 uppercase tracking-widest">Personalize Vani's Voice</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar max-h-[70vh]">
          {/* Gender Filter */}
          <div className="space-y-4">
            <label className="text-xs font-mono opacity-40 uppercase flex items-center gap-2">
              <UserIcon className="w-4 h-4" />
              Voice Gender
            </label>
            <div className="flex p-1 bg-white/5 rounded-2xl border border-white/10">
              {['All', 'Male', 'Female'].map((g) => (
                <button
                  key={g}
                  onClick={() => setGenderFilter(g as any)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
                    genderFilter === g 
                    ? 'bg-white/10 text-white shadow-lg' 
                    : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Voice Selection */}
          <div className="space-y-4">
            <label className="text-xs font-mono opacity-40 uppercase flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              AI Voice Profile
            </label>
            <div className="grid grid-cols-1 gap-3">
              {/* Best Recommendation */}
              <div className="space-y-2">
                <span className="text-[10px] font-mono opacity-30 uppercase tracking-tighter">Recommended</span>
                {filteredVoices.filter(v => v.best).map(v => (
                  <button
                    key={v.id}
                    onClick={() => setSettings({ ...settings, voiceName: v.id, gender: v.gender })}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium border transition-all ${
                      settings.voiceName === v.id 
                      ? 'bg-[#ff4e00]/10 border-[#ff4e00]/30 text-white' 
                      : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3 text-left">
                      <div className={`w-2 h-2 rounded-full ${settings.voiceName === v.id ? 'bg-[#ff4e00]' : 'bg-white/20'}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span>{v.label}</span>
                          <span className="text-[10px] opacity-50">({v.gender})</span>
                        </div>
                        {v.description && <p className="text-[10px] opacity-30 font-normal">{v.description}</p>}
                      </div>
                    </div>
                    <span className="text-[10px] bg-[#ff4e00] text-white px-2 py-0.5 rounded-full font-bold">BEST</span>
                  </button>
                ))}
              </div>

              {/* Others */}
              <div className="space-y-2 pt-2">
                <span className="text-[10px] font-mono opacity-30 uppercase tracking-tighter">Other Profiles</span>
                <div className="grid grid-cols-2 gap-2">
                  {filteredVoices.filter(v => !v.best).map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSettings({ ...settings, voiceName: v.id, gender: v.gender })}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-medium border transition-all ${
                        settings.voiceName === v.id 
                        ? 'bg-white/10 border-white/30 text-white' 
                        : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${settings.voiceName === v.id ? 'bg-white' : 'bg-white/20'}`} />
                      <div className="text-left">
                        <div className="flex items-center gap-1">
                          <span>{v.label}</span>
                        </div>
                        <span className="text-[9px] opacity-30 block">({v.gender})</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Emotional Style Selection */}
          <div className="space-y-4">
            <label className="text-xs font-mono opacity-40 uppercase flex items-center gap-2">
              <Heart className="w-4 h-4" />
              Emotional Style
            </label>
            <div className="flex flex-wrap gap-2">
              {emotionalStyles.map(s => (
                <button
                  key={s}
                  onClick={() => setSettings({ ...settings, emotionalStyle: s })}
                  className={`px-4 py-2 rounded-xl text-xs font-medium border transition-all ${
                    settings.emotionalStyle === s 
                    ? 'bg-white/10 border-white/30 text-white' 
                    : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Accent Selection */}
          <div className="space-y-4">
            <label className="text-xs font-mono opacity-40 uppercase flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Regional Accent
            </label>
            <div className="grid grid-cols-2 gap-2">
              {accents.map(a => (
                <button
                  key={a}
                  onClick={() => setSettings({ ...settings, accent: a })}
                  className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                    settings.accent === a 
                    ? 'bg-white/10 border-white/30 text-white' 
                    : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Speed & Pitch */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <label className="text-xs font-mono opacity-40 uppercase">Speech Rate</label>
              <div className="space-y-2">
                {speeds.map(s => (
                  <button
                    key={s}
                    onClick={() => setSettings({ ...settings, speed: s })}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                      settings.speed === s 
                      ? 'bg-white/10 border-white/30 text-white' 
                      : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-xs font-mono opacity-40 uppercase">Vocal Pitch</label>
              <div className="space-y-2">
                {pitches.map(p => (
                  <button
                    key={p}
                    onClick={() => setSettings({ ...settings, pitch: p })}
                    className={`w-full px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                      settings.pitch === p 
                      ? 'bg-white/10 border-white/30 text-white' 
                      : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 border-t border-white/5">
          <button 
            onClick={onClose}
            className="w-full py-4 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold transition-all"
          >
            Apply Settings
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AdminPanel({ onClose, settings, knowledge }: { onClose: () => void, settings: any, knowledge: any[] }) {
  const [activeTab, setActiveTab] = useState<'settings' | 'knowledge' | 'ai' | 'developer' | 'rag'>('settings');
  const [localSettings, setLocalSettings] = useState(settings);
  const [newDoc, setNewDoc] = useState({ title: '', content: '' });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appUrl = window.location.origin;
  const widgetCode = `<iframe 
  src="${appUrl}?widget=true" 
  width="400" 
  height="600" 
  frameborder="0" 
  style="border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);"
></iframe>`;

  const saveSettings = async () => {
    try {
      await setDoc(doc(db, 'settings', 'global'), localSettings);
      toast.success('Settings saved successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    formData.append('config', JSON.stringify({
      chunkSize: localSettings.chunkSize,
      overlap: localSettings.overlap,
      provider: localSettings.vectorProvider,
      endpoint: localSettings.vectorEndpoint,
      collection: localSettings.vectorCollection,
      embeddingModel: localSettings.embeddingModel
    }));

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        toast.success(data.message);
        // If using firestore, we might want to refresh the local list
        // but the server handles the vector DB push
      } else {
        toast.error(data.error || 'Upload failed');
      }
    } catch (err) {
      toast.error('Upload failed: ' + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const addKnowledge = async () => {
    if (!newDoc.title || !newDoc.content) return toast.error('Title and content required');
    try {
      await addDoc(collection(db, 'knowledge'), {
        ...newDoc,
        authorId: auth.currentUser?.uid || 'admin',
        createdAt: serverTimestamp(),
      });
      setNewDoc({ title: '', content: '' });
      toast.success('Knowledge added');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'knowledge');
    }
  };

  const deleteKnowledge = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'knowledge', id));
      toast.success('Document deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `knowledge/${id}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-[#151619] w-full max-w-5xl h-[85vh] rounded-[40px] border border-white/10 overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between p-8 border-b border-white/5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-yellow-500/10 rounded-2xl">
              <Shield className="w-6 h-6 text-yellow-500" />
            </div>
            <div>
              <h2 className="text-2xl font-serif italic">Admin Control Center</h2>
              <p className="text-xs font-mono opacity-40 uppercase tracking-widest">Version 2.0 • Configurable Backend</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 border-r border-white/5 p-6 space-y-2">
            <button 
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${activeTab === 'settings' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Palette className="w-5 h-5" />
              <span className="font-medium">UI Settings</span>
            </button>
            <button 
              onClick={() => setActiveTab('knowledge')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${activeTab === 'knowledge' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Book className="w-5 h-5" />
              <span className="font-medium">Knowledge Base</span>
            </button>
            <button 
              onClick={() => setActiveTab('rag')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${activeTab === 'rag' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Database className="w-5 h-5" />
              <span className="font-medium">RAG Infrastructure</span>
            </button>
            <button 
              onClick={() => setActiveTab('ai')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${activeTab === 'ai' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Shield className="w-5 h-5" />
              <span className="font-medium">AI Configuration</span>
            </button>
            <button 
              onClick={() => setActiveTab('developer')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${activeTab === 'developer' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
            >
              <Globe className="w-5 h-5" />
              <span className="font-medium">Developer / API</span>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
            {activeTab === 'settings' ? (
              <div className="space-y-10 max-w-2xl">
                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Globe className="w-5 h-5 text-[#ff4e00]" />
                    General Configuration
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">App Name</label>
                      <input 
                        type="text" 
                        value={localSettings.appName}
                        onChange={e => setLocalSettings({...localSettings, appName: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Logo URL</label>
                      <input 
                        type="text" 
                        value={localSettings.logoUrl}
                        onChange={e => setLocalSettings({...localSettings, logoUrl: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-mono opacity-40 uppercase">System Instruction (RAG Behavior)</label>
                      <button 
                        onClick={() => setLocalSettings({...localSettings, systemInstruction: DEFAULT_SETTINGS.systemInstruction})}
                        className="text-[10px] font-mono text-[#ff4e00] hover:underline"
                      >
                        RESET TO DEFAULT
                      </button>
                    </div>
                    <textarea 
                      value={localSettings.systemInstruction}
                      onChange={e => setLocalSettings({...localSettings, systemInstruction: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 h-32 resize-none focus:border-[#ff4e00]/50 outline-none"
                    />
                  </div>
                </section>

                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Palette className="w-5 h-5 text-[#ff4e00]" />
                    Theme & Colors
                  </h3>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Primary</label>
                      <div className="flex gap-2">
                        <input type="color" value={localSettings.primaryColor} onChange={e => setLocalSettings({...localSettings, primaryColor: e.target.value})} className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer" />
                        <input type="text" value={localSettings.primaryColor} onChange={e => setLocalSettings({...localSettings, primaryColor: e.target.value})} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Secondary</label>
                      <div className="flex gap-2">
                        <input type="color" value={localSettings.secondaryColor} onChange={e => setLocalSettings({...localSettings, secondaryColor: e.target.value})} className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer" />
                        <input type="text" value={localSettings.secondaryColor} onChange={e => setLocalSettings({...localSettings, secondaryColor: e.target.value})} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 text-xs" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Background</label>
                      <div className="flex gap-2">
                        <input type="color" value={localSettings.backgroundColor} onChange={e => setLocalSettings({...localSettings, backgroundColor: e.target.value})} className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer" />
                        <input type="text" value={localSettings.backgroundColor} onChange={e => setLocalSettings({...localSettings, backgroundColor: e.target.value})} className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 text-xs" />
                      </div>
                    </div>
                  </div>
                </section>

                <button 
                  onClick={saveSettings}
                  className="w-full py-4 bg-[#ff4e00] text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#ff4e00]/90 transition-all shadow-xl shadow-[#ff4e00]/20"
                >
                  <Save className="w-5 h-5" />
                  Save Global Configuration
                </button>
              </div>
            ) : activeTab === 'rag' ? (
              <div className="space-y-10 max-w-2xl">
                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Database className="w-5 h-5 text-[#ff4e00]" />
                    Vector Storage Configuration
                  </h3>
                  <p className="text-sm text-white/40">Configure your preferred open-source vector store for advanced RAG capabilities.</p>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Vector Provider</label>
                      <select 
                        value={localSettings.vectorProvider}
                        onChange={e => setLocalSettings({...localSettings, vectorProvider: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none text-white appearance-none"
                      >
                        <option value="firestore">Firestore (Simulated)</option>
                        <option value="chroma">ChromaDB</option>
                        <option value="qdrant">Qdrant</option>
                        <option value="milvus">Milvus</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Endpoint URL</label>
                      <input 
                        type="text" 
                        placeholder="http://localhost:8000"
                        value={localSettings.vectorEndpoint}
                        onChange={e => setLocalSettings({...localSettings, vectorEndpoint: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Collection Name</label>
                      <input 
                        type="text" 
                        value={localSettings.vectorCollection}
                        onChange={e => setLocalSettings({...localSettings, vectorCollection: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Embedding Model</label>
                      <input 
                        type="text" 
                        value={localSettings.embeddingModel}
                        onChange={e => setLocalSettings({...localSettings, embeddingModel: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Settings2 className="w-5 h-5 text-[#ff4e00]" />
                    Advanced Text Processing
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Chunk Size (chars)</label>
                      <input 
                        type="number" 
                        value={localSettings.chunkSize}
                        onChange={e => setLocalSettings({...localSettings, chunkSize: parseInt(e.target.value)})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Overlap (chars)</label>
                      <input 
                        type="number" 
                        value={localSettings.overlap}
                        onChange={e => setLocalSettings({...localSettings, overlap: parseInt(e.target.value)})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Upload className="w-5 h-5 text-[#ff4e00]" />
                    Multi-Source Ingestion
                  </h3>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed border-white/10 rounded-3xl p-10 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-[#ff4e00]/50 transition-all ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <div className="p-4 bg-[#ff4e00]/10 rounded-full">
                      <FileText className="w-8 h-8 text-[#ff4e00]" />
                    </div>
                    <div className="text-center">
                      <p className="font-bold">Click to upload PDF documents</p>
                      <p className="text-xs text-white/40 mt-1">Bulk upload multiple files for ingestion</p>
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleBulkUpload}
                      multiple 
                      accept=".pdf" 
                      className="hidden" 
                    />
                    {uploading && (
                      <div className="flex items-center gap-2 text-xs text-[#ff4e00] font-mono animate-pulse">
                        <div className="w-2 h-2 bg-[#ff4e00] rounded-full" />
                        PROCESSING DOCUMENTS...
                      </div>
                    )}
                  </div>
                </section>

                <button 
                  onClick={saveSettings}
                  className="w-full py-4 bg-[#ff4e00] text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#ff4e00]/90 transition-all shadow-xl shadow-[#ff4e00]/20"
                >
                  <Save className="w-5 h-5" />
                  Save RAG Configuration
                </button>
              </div>
            ) : activeTab === 'ai' ? (
              <div className="space-y-10 max-w-2xl">
                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Shield className="w-5 h-5 text-[#ff4e00]" />
                    AI Backend Configuration
                  </h3>
                  <p className="text-sm text-white/40">Switch between different AI providers. Note: Only Gemini currently supports native low-latency audio. Other providers will use a standard LLM pipeline.</p>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">AI Provider</label>
                      <select 
                        value={localSettings.aiProvider}
                        onChange={e => setLocalSettings({...localSettings, aiProvider: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none text-white appearance-none"
                      >
                        <option value="gemini">Google Gemini (Live Audio)</option>
                        <option value="ollama">Ollama (Local LLM)</option>
                        <option value="grok">Grok (xAI)</option>
                        <option value="openai">OpenAI</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Model Name</label>
                      <input 
                        type="text" 
                        placeholder={localSettings.aiProvider === 'gemini' ? 'gemini-2.5-flash-native-audio-preview-12-2025' : 'e.g. llama3, grok-1'}
                        value={localSettings.modelName}
                        onChange={e => setLocalSettings({...localSettings, modelName: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                  </div>

                  {localSettings.aiProvider === 'ollama' && (
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">Ollama API URL</label>
                      <input 
                        type="text" 
                        placeholder="http://localhost:11434"
                        value={localSettings.apiUrl}
                        onChange={e => setLocalSettings({...localSettings, apiUrl: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                    </div>
                  )}

                  {localSettings.aiProvider !== 'ollama' && (
                    <div className="space-y-2">
                      <label className="text-xs font-mono opacity-40 uppercase">API Key (Optional if using environment key)</label>
                      <input 
                        type="password" 
                        placeholder="••••••••••••••••"
                        value={localSettings.apiKey}
                        onChange={e => setLocalSettings({...localSettings, apiKey: e.target.value})}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 focus:border-[#ff4e00]/50 outline-none"
                      />
                      <p className="text-[10px] text-white/30 italic">If left blank, the system will use the default server-side key.</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <Globe className="w-5 h-5 text-[#ff4e00]" />
                      <div>
                        <p className="font-medium">Google Search Grounding</p>
                        <p className="text-xs text-white/40">Use real-time search for up-to-date answers</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setLocalSettings({...localSettings, searchGrounding: !localSettings.searchGrounding})}
                      className={`w-12 h-6 rounded-full transition-all relative ${localSettings.searchGrounding ? 'bg-[#ff4e00]' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${localSettings.searchGrounding ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                </section>

                <button 
                  onClick={saveSettings}
                  className="w-full py-4 bg-[#ff4e00] text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#ff4e00]/90 transition-all shadow-xl shadow-[#ff4e00]/20"
                >
                  <Save className="w-5 h-5" />
                  Save AI Configuration
                </button>
              </div>
            ) : activeTab === 'developer' ? (
              <div className="space-y-10 max-w-2xl">
                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Globe className="w-5 h-5 text-[#ff4e00]" />
                    Plug & Play Widget
                  </h3>
                  <p className="text-sm text-white/40">Embed Vani as a widget on any website using this iframe code. You can customize the appearance via the UI Settings tab.</p>
                  <div className="bg-black/40 p-6 rounded-2xl border border-white/10 font-mono text-xs text-white/70 relative group">
                    <pre className="whitespace-pre-wrap break-all">{widgetCode}</pre>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(widgetCode);
                        toast.success('Widget code copied!');
                      }}
                      className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                  </div>
                </section>

                <section className="space-y-6">
                  <h3 className="text-lg font-medium flex items-center gap-2 text-white/90">
                    <Shield className="w-5 h-5 text-[#ff4e00]" />
                    API Documentation
                  </h3>
                  <div className="space-y-4 text-sm text-white/60">
                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                      <h4 className="font-bold text-white mb-1">Admin URL</h4>
                      <p className="font-mono text-[10px] text-[#ff4e00]">{appUrl}?admin=true</p>
                      <p className="mt-2">Use this URL to access the Admin Control Center from anywhere.</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                      <h4 className="font-bold text-white mb-1">RAG / Knowledge Base</h4>
                      <p>The Knowledge Base tab allows you to upload documents that the AI uses for context. This is a "Plug & Play" RAG system powered by Firestore.</p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                      <h4 className="font-bold text-white mb-1">Customization</h4>
                      <p>All settings (Voice, Theme, AI Provider) are saved globally. Changes reflect instantly across all embedded widgets.</p>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="bg-white/5 p-8 rounded-3xl border border-white/10 space-y-4">
                  <h3 className="text-lg font-medium">Add New Knowledge</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <input
                      type="text"
                      placeholder="Document Title"
                      value={newDoc.title}
                      onChange={e => setNewDoc({ ...newDoc, title: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#ff4e00]/50"
                    />
                    <textarea
                      placeholder="Content for RAG context..."
                      value={newDoc.content}
                      onChange={e => setNewDoc({ ...newDoc, content: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 h-40 resize-none outline-none focus:border-[#ff4e00]/50"
                    />
                    <button
                      onClick={addKnowledge}
                      className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      Add to Knowledge Base
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {knowledge.map(doc => (
                    <div key={doc.id} className="p-6 bg-white/5 rounded-3xl border border-white/5 hover:border-white/20 transition-all group relative">
                      <button 
                        onClick={() => deleteKnowledge(doc.id)}
                        className="absolute top-4 right-4 p-2 text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <h4 className="font-bold mb-2 pr-8">{doc.title}</h4>
                      <p className="text-sm opacity-40 line-clamp-3 leading-relaxed">{doc.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
