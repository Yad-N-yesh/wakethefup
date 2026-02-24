/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";
import { QRCodeSVG } from 'qrcode.react';
import { Camera, CheckCircle2, Loader2, Sparkles, Timer, AlertCircle, RefreshCcw, QrCode } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type AppState = 'IDLE' | 'APPLYING_TOOTHPASTE' | 'BRUSHING' | 'FINISHED' | 'ERROR';

interface DetectionResult {
  isApplyingToothpaste: boolean;
  isBrushInMouth: boolean;
  isBrushing: boolean;
  confidence: number;
  reasoning: string;
}

// --- Constants ---

const ANALYSIS_INTERVAL = 3000; // 3 seconds
const BRUSHING_REQUIRED_TIME = 10; // 10 seconds
const GEMINI_MODEL = "gemini-3-flash-preview";

export default function App() {
  // --- State ---
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [brushingTime, setBrushingTime] = useState(0);
  const [qrContent, setQrContent] = useState('https://google.com'); // Default QR
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready to start');
  const [showQrInput, setShowQrInput] = useState(false);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const brushingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // --- AI Initialization ---
  const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // --- Camera Setup ---
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
      setAppState('IDLE');
      setError(null);
    } catch (err) {
      console.error("Camera error:", err);
      setError("Could not access camera. Please ensure permissions are granted.");
      setAppState('ERROR');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // --- Analysis Logic ---

  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  };

  const analyzeFrame = useCallback(async () => {
    if (appState === 'FINISHED' || appState === 'ERROR') return;

    const base64Image = captureFrame();
    if (!base64Image) return;

    setIsAnalyzing(true);
    try {
      const ai = getAI();
      const prompt = `
        Analyze this image of a person brushing their teeth. 
        The brush is GREEN and PURPLE.
        The toothpaste is RED and BLUE.
        
        Current App State: ${appState}
        
        Tasks:
        1. Is the user currently applying the RED and BLUE toothpaste onto the GREEN and PURPLE brush?
        2. Is the GREEN and PURPLE brush currently inside the user's mouth?
        3. Is the user actively brushing their teeth?
        
        Return a JSON object with:
        {
          "isApplyingToothpaste": boolean,
          "isBrushInMouth": boolean,
          "isBrushing": boolean,
          "confidence": number (0-1),
          "reasoning": string
        }
      `;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image } }
          ]
        }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result: DetectionResult = JSON.parse(response.text || '{}');
      handleDetectionResult(result);
    } catch (err) {
      console.error("AI Analysis error:", err);
      // Don't set error state here to allow retries
    } finally {
      setIsAnalyzing(false);
    }
  }, [appState]);

  const handleDetectionResult = (result: DetectionResult) => {
    if (result.confidence < 0.4) return;

    setAppState(prev => {
      if (prev === 'IDLE' && result.isApplyingToothpaste) {
        setStatusMessage("Toothpaste detected! Now put the brush in your mouth.");
        return 'APPLYING_TOOTHPASTE';
      }
      
      if (prev === 'APPLYING_TOOTHPASTE' && result.isBrushInMouth) {
        setStatusMessage("Brushing detected! Keep going for 10 seconds.");
        return 'BRUSHING';
      }

      if (prev === 'BRUSHING' && !result.isBrushing && !result.isBrushInMouth) {
        // If they stop brushing before 10s, we might want to reset or pause
        // For now, let's just keep the timer going if they are still in the mouth
      }

      return prev;
    });
  };

  // --- Timer Logic ---
  useEffect(() => {
    if (appState === 'BRUSHING') {
      brushingTimerRef.current = setInterval(() => {
        setBrushingTime(prev => {
          if (prev >= BRUSHING_REQUIRED_TIME) {
            setAppState('FINISHED');
            setStatusMessage("Great job! Here is your reward.");
            if (brushingTimerRef.current) clearInterval(brushingTimerRef.current);
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (brushingTimerRef.current) clearInterval(brushingTimerRef.current);
      if (appState !== 'FINISHED') setBrushingTime(0);
    }

    return () => {
      if (brushingTimerRef.current) clearInterval(brushingTimerRef.current);
    };
  }, [appState]);

  // --- Main Loop ---
  useEffect(() => {
    if (appState !== 'FINISHED' && appState !== 'ERROR') {
      intervalRef.current = setInterval(analyzeFrame, ANALYSIS_INTERVAL);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [appState, analyzeFrame]);

  const reset = () => {
    setAppState('IDLE');
    setBrushingTime(0);
    setStatusMessage("Ready to start");
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans p-4 md:p-8 flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 p-2 rounded-xl shadow-lg shadow-emerald-200">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">BrushTrack AI</h1>
        </div>
        <button 
          onClick={() => setShowQrInput(!showQrInput)}
          className="p-2 hover:bg-white rounded-full transition-colors border border-black/5"
          title="Configure Reward"
        >
          <QrCode className="w-5 h-5 opacity-60" />
        </button>
      </header>

      <main className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Camera Section */}
        <div className="lg:col-span-8 space-y-6">
          <div className="relative aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-white">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* Overlays */}
            <AnimatePresence>
              {isAnalyzing && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute top-4 right-4 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/20"
                >
                  <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  <span className="text-white text-xs font-medium uppercase tracking-wider">AI Analyzing...</span>
                </motion.div>
              )}
            </AnimatePresence>

            {appState === 'BRUSHING' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-emerald-500/90 backdrop-blur-xl text-white px-8 py-4 rounded-3xl shadow-2xl flex flex-col items-center"
                >
                  <Timer className="w-12 h-12 mb-2 animate-pulse" />
                  <span className="text-5xl font-black tabular-nums">
                    {BRUSHING_REQUIRED_TIME - brushingTime}s
                  </span>
                  <span className="text-sm font-bold uppercase tracking-widest mt-1 opacity-80">Remaining</span>
                </motion.div>
              </div>
            )}
          </div>

          {/* Status Card */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-2xl ${
                appState === 'FINISHED' ? 'bg-emerald-100 text-emerald-600' : 
                appState === 'ERROR' ? 'bg-red-100 text-red-600' :
                'bg-blue-100 text-blue-600'
              }`}>
                {appState === 'FINISHED' ? <CheckCircle2 /> : 
                 appState === 'ERROR' ? <AlertCircle /> : <Camera />}
              </div>
              <div>
                <p className="text-sm font-semibold text-black/40 uppercase tracking-wider">Current Status</p>
                <p className="text-lg font-bold">{statusMessage}</p>
              </div>
            </div>
            {appState === 'FINISHED' && (
              <button 
                onClick={reset}
                className="flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-2xl font-bold hover:bg-black/80 transition-all active:scale-95"
              >
                <RefreshCcw className="w-4 h-4" />
                Restart
              </button>
            )}
          </div>
        </div>

        {/* Sidebar / Info */}
        <div className="lg:col-span-4 space-y-6">
          {/* QR Config (Hidden by default) */}
          <AnimatePresence>
            {showQrInput && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 mb-6">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <QrCode className="w-4 h-4" /> Reward Content
                  </h3>
                  <input 
                    type="text" 
                    value={qrContent}
                    onChange={(e) => setQrContent(e.target.value)}
                    placeholder="Enter URL or text..."
                    className="w-full px-4 py-3 rounded-xl bg-zinc-50 border border-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                  <p className="text-[10px] text-black/40 mt-3 uppercase font-bold tracking-wider">This will be revealed after brushing</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Progress Steps */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
            <h3 className="font-bold mb-6 text-black/40 uppercase text-xs tracking-widest">The Mission</h3>
            <div className="space-y-6">
              <Step 
                num="01" 
                label="Apply Toothpaste" 
                desc="Red & Blue paste on Green & Purple brush"
                active={appState === 'IDLE' || appState === 'APPLYING_TOOTHPASTE'}
                done={appState !== 'IDLE' && appState !== 'ERROR'}
              />
              <Step 
                num="02" 
                label="Start Brushing" 
                desc="Put the brush in your mouth"
                active={appState === 'APPLYING_TOOTHPASTE' || appState === 'BRUSHING'}
                done={appState === 'FINISHED'}
              />
              <Step 
                num="03" 
                label="10s Brushing" 
                desc="Keep going until the timer ends"
                active={appState === 'BRUSHING'}
                done={appState === 'FINISHED'}
              />
            </div>
          </div>

          {/* Reward Card */}
          <AnimatePresence>
            {appState === 'FINISHED' && (
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-emerald-500 p-8 rounded-3xl shadow-2xl shadow-emerald-200 text-center flex flex-col items-center"
              >
                <div className="bg-white p-4 rounded-2xl shadow-inner mb-6">
                  <QRCodeSVG value={qrContent} size={160} />
                </div>
                <h3 className="text-white font-black text-xl mb-2">Reward Unlocked!</h3>
                <p className="text-emerald-50 text-sm font-medium opacity-80">Scan this code for your reward.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-8 bg-red-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="font-bold">{error}</span>
            <button onClick={startCamera} className="ml-4 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-sm font-bold transition-colors">
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Step({ num, label, desc, active, done }: { num: string, label: string, desc: string, active: boolean, done: boolean }) {
  return (
    <div className={`flex gap-4 transition-all duration-500 ${active ? 'opacity-100 scale-105' : 'opacity-40'}`}>
      <div className={`text-2xl font-black font-mono ${done ? 'text-emerald-500' : 'text-black/20'}`}>
        {done ? '✓' : num}
      </div>
      <div>
        <p className={`font-bold leading-tight ${done ? 'line-through opacity-50' : ''}`}>{label}</p>
        <p className="text-xs text-black/60 font-medium mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
