import React, { useState, useEffect, useRef } from 'react';
import { auth, db, getKnowledgeBase, getGlobalSettings } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { GeminiVoiceAgent } from './lib/gemini';
import { Mic, MicOff, Book, Send, LogIn, LogOut, Settings, MessageSquare, Plus, Trash2, X, Shield, Save, Palette, Globe, Languages } from 'lucide-react';
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
  systemInstruction: 'You are Vani, a helpful Indian Voice Assistant. Respond concisely and naturally.'
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
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showAdmin, setShowAdmin] = useState(false);
  const [selectedLang, setSelectedLang] = useState(DEFAULT_LANGUAGES[0]);
  const [loading, setLoading] = useState(true);
  
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

  const startAgent = async () => {
    try {
      const kbContent = await getKnowledgeBase();
      const systemInstruction = `
        ${settings.systemInstruction}
        The user's preferred language is ${selectedLang.name}.
        
        KNOWLEDGE BASE CONTEXT:
        ${kbContent || "No specific knowledge base content provided yet."}
      `;

      agentRef.current = new GeminiVoiceAgent(
        process.env.GEMINI_API_KEY!,
        (msg) => setLastMessage(msg),
        (s) => setStatus(s)
      );

      await agentRef.current.connect(systemInstruction);
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
      <header className="relative z-10 flex items-center justify-between p-6 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
          ) : (
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
              style={{ background: `linear-gradient(to tr, ${settings.primaryColor}, ${settings.secondaryColor})`, boxShadow: `0 0 20px ${settings.primaryColor}40` }}
            >
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
          )}
          <h1 className="text-2xl font-serif italic tracking-tight">{settings.appName}</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button 
              onClick={() => setShowAdmin(true)}
              className="p-2 hover:bg-white/5 rounded-full transition-colors flex items-center gap-2"
              title="Admin Panel"
            >
              <Shield className="w-5 h-5 text-yellow-500" />
              <span className="text-xs font-mono hidden sm:inline">ADMIN</span>
            </button>
          )}

          {user ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
              <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
              <button onClick={handleLogout} className="p-1 hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button onClick={handleLogin} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <LogIn className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto p-8 pt-12">
        <div className="flex flex-col items-center text-center space-y-12">
          
          <div className="space-y-4">
            <h2 className="text-5xl font-serif italic">Namaste, I'm {settings.appName}</h2>
            <p className="text-[#e0d8d0]/60 text-lg">Your multilingual AI voice companion</p>
          </div>

          {/* Language Selector */}
          <div className="flex flex-wrap justify-center gap-3 max-w-2xl">
            {settings.languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => setSelectedLang(lang)}
                className={`px-4 py-2 rounded-full text-sm font-medium border transition-all duration-300 ${
                  selectedLang.code === lang.code 
                  ? 'text-white shadow-lg' 
                  : 'bg-white/5 border-white/10 hover:border-white/30 text-white/60'
                }`}
                style={selectedLang.code === lang.code ? { backgroundColor: settings.primaryColor, borderColor: settings.primaryColor, boxShadow: `0 10px 20px ${settings.primaryColor}30` } : {}}
              >
                {lang.name}
              </button>
            ))}
          </div>

          {/* Mic Button */}
          <div className="relative group py-8">
            <AnimatePresence>
              {isRecording && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1.6, opacity: 0.4 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full blur-3xl"
                  style={{ backgroundColor: settings.primaryColor }}
                />
              )}
            </AnimatePresence>
            
            <button
              onClick={isRecording ? stopAgent : startAgent}
              className={`relative z-10 w-40 h-40 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl ${
                isRecording ? 'scale-110' : 'bg-white/5 hover:bg-white/10 border border-white/10'
              }`}
              style={isRecording ? { backgroundColor: settings.primaryColor, boxShadow: `0 0 50px ${settings.primaryColor}60` } : {}}
            >
              {isRecording ? <Mic className="w-16 h-16 text-white animate-pulse" /> : <MicOff className="w-16 h-16 text-white/40" />}
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3">
              <div 
                className={`w-3 h-3 rounded-full ${isRecording ? 'animate-ping' : 'opacity-20'}`} 
                style={{ backgroundColor: isRecording ? '#22c55e' : '#fff' }}
              />
              <span className="text-sm font-mono uppercase tracking-[0.2em] opacity-40">{status}</span>
            </div>
            <AnimatePresence>
              {lastMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-6 bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 max-w-xl"
                >
                  <p className="text-xl font-serif italic text-white/90 leading-relaxed">
                    "{lastMessage}"
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

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

function AdminPanel({ onClose, settings, knowledge }: { onClose: () => void, settings: any, knowledge: any[] }) {
  const [activeTab, setActiveTab] = useState<'settings' | 'knowledge'>('settings');
  const [localSettings, setLocalSettings] = useState(settings);
  const [newDoc, setNewDoc] = useState({ title: '', content: '' });

  const saveSettings = async () => {
    try {
      await setDoc(doc(db, 'settings', 'global'), localSettings);
      toast.success('Settings saved successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
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
                    <label className="text-xs font-mono opacity-40 uppercase">System Instruction (RAG Behavior)</label>
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
