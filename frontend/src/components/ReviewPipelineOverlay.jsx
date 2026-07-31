import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle2, XCircle, Loader2, Circle, Clock, Check, Terminal, Play, X } from 'lucide-react';

const STAGES = [
  { id: 0, title: 'Import Repository', description: 'Preparing uploaded repository...' },
  { id: 1, title: 'Generate Repository Fingerprint', description: 'Generating SHA-256 hash...' },
  { id: 2, title: 'Checking Redis Cache', description: 'Querying Redis...' },
  { id: 3, title: 'Scanning Repository', description: 'Discovering files & languages...' },
  { id: 4, title: 'Preparing AI Context', description: 'Reading source & building chunks...' },
  { id: 5, title: 'AI Analysis', description: 'Reviewing code & generating scores...' },
  { id: 6, title: 'Saving Review', description: 'Saving review history & cache...' },
  { id: 7, title: 'Completed', description: 'Review Finished Successfully' },
];

const ReviewPipelineOverlay = ({ isOpen, repo, logs, error, isSuccess, onClose, onRetry }) => {
  const [currentStage, setCurrentStage] = useState(0);
  const [cacheHit, setCacheHit] = useState(null);
  const [analyzedChunks, setAnalyzedChunks] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState('0s');
  
  const logsEndRef = useRef(null);

  // Timer effect
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(`${seconds}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, startTime]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Stage Management Effect
  useEffect(() => {
    if (!isOpen) {
      setCurrentStage(0);
      setCacheHit(null);
      return;
    }

    let activeStage = 0;

    // Simulate first 2 stages quickly if no logs yet
    if (logs.length === 0 && !error && !isSuccess) {
      const t1 = setTimeout(() => setCurrentStage(1), 300);
      const t2 = setTimeout(() => setCurrentStage(2), 800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }

    if (logs.length > 0) {
      activeStage = 2; // Default to checking cache once logs start

      // Parse logs to determine stage
      for (const log of logs) {
        const msg = log.message || '';
        
        if (msg.includes('Cache HIT')) {
          setCacheHit(true);
          activeStage = 7;
          break; // Skip everything else
        }
        
        if (msg.includes('Scanning Repository')) {
          setCacheHit(false);
          activeStage = Math.max(activeStage, 3);
        }
        if (msg.includes('Building Chunks')) {
          activeStage = Math.max(activeStage, 4);
        }
        if (msg.includes('Analyzing') && msg.includes('chunks with AI')) {
          activeStage = Math.max(activeStage, 5);
          // Extract total chunks: "Analyzing 49 chunks with AI..."
          const match = msg.match(/Analyzing (\d+)/);
          if (match) setTotalChunks(parseInt(match[1], 10));
        }
        if (msg.includes('Analyzed') && msg.includes('/')) {
          activeStage = Math.max(activeStage, 5);
          // Extract progress: "Analyzed 10 / 49 chunks..."
          const match = msg.match(/Analyzed (\d+)/);
          if (match) setAnalyzedChunks(parseInt(match[1], 10));
        }
        if (msg.includes('Generating final report')) {
          activeStage = Math.max(activeStage, 5); // Still in AI phase until success
        }
      }
    }

    // Success overrides
    if (isSuccess) {
      activeStage = 7;
    }

    setCurrentStage(activeStage);
  }, [logs, isOpen, error, isSuccess]);

  // Success Auto-Close Effect
  useEffect(() => {
    if (isSuccess && isOpen) {
      const t = setTimeout(() => {
        onClose();
      }, 1500); // 1.5 second delay before dismissing automatically
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, isOpen]);

  if (!isOpen) return null;

  // Calculate Progress
  let progressPercent = 0;
  if (cacheHit) {
    progressPercent = 100;
  } else if (currentStage === 7) {
    progressPercent = 100;
  } else if (currentStage === 5) {
    // Stage 5 is from ~60% to 85%
    const base = 60;
    const dynamic = (analyzedChunks / totalChunks) * 25;
    progressPercent = base + dynamic;
  } else {
    // 0 -> 0%, 1 -> 15%, 2 -> 30%, 3 -> 45%, 4 -> 60%, 6 -> 90%
    const stageMap = { 0: 0, 1: 15, 2: 30, 3: 45, 4: 60, 6: 90 };
    progressPercent = stageMap[currentStage] || 0;
  }
  progressPercent = Math.min(100, Math.max(0, progressPercent));

  // Determine stage status
  const getStageStatus = (stageId) => {
    if (error && currentStage === stageId) return 'failed';
    if (cacheHit && stageId > 2 && stageId < 7) return 'skipped'; // Skipped stages for Cache HIT
    if (currentStage > stageId || (currentStage === 7 && isSuccess)) return 'completed';
    if (currentStage === stageId) return 'running';
    return 'pending';
  };

  const renderStageIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="text-green-500 w-5 h-5" />;
      case 'failed': return <XCircle className="text-red-500 w-5 h-5" />;
      case 'running': return <Loader2 className="text-blue-500 w-5 h-5 animate-spin" />;
      case 'skipped': return <Circle className="text-gray-600 w-5 h-5 opacity-30" />;
      default: return <Circle className="text-gray-600 w-5 h-5" />;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-8">
      <div className="bg-gray-900 border border-gray-700 w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800 bg-gray-950/50">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Play className="text-blue-500 w-5 h-5" />
              AI Review Pipeline
            </h2>
            <p className="text-sm text-gray-400 mt-1">Executing automated review on <span className="font-mono text-gray-300">{repo?.name}</span></p>
          </div>
          {(!isSuccess && error) && (
            <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full bg-gray-800 overflow-hidden relative">
          <div 
            className={`h-full transition-all duration-500 ease-out ${error ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel - Timeline */}
          <div className="w-1/3 min-w-[300px] border-r border-gray-800 p-6 overflow-y-auto bg-gray-950">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-6">Pipeline Stages</h3>
            <div className="space-y-6 relative">
              {STAGES.map((stage, idx) => {
                const status = getStageStatus(stage.id);
                // Dynamic descriptions
                let description = stage.description;
                if (stage.id === 2 && cacheHit === true) description = '⚡ Cache Hit! Skipping AI analysis.';
                if (stage.id === 2 && cacheHit === false) description = 'Cache Miss. Starting AI Review...';
                
                return (
                  <div key={stage.id} className={`flex items-start gap-4 transition-opacity duration-300 ${status === 'pending' || status === 'skipped' ? 'opacity-40' : 'opacity-100'}`}>
                    <div className="mt-0.5 relative z-10 bg-gray-950">
                      {renderStageIcon(status)}
                    </div>
                    {/* Connecting line */}
                    {idx < STAGES.length - 1 && (
                      <div className="absolute left-[9px] w-0.5 h-12 -ml-[1px] bg-gray-800 -z-0 mt-6" />
                    )}
                    <div className="flex-1">
                      <p className={`font-medium ${status === 'running' ? 'text-blue-400' : status === 'failed' ? 'text-red-400' : 'text-gray-200'}`}>
                        {stage.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel - Terminal & Stats */}
          <div className="flex-1 flex flex-col bg-[#0d1117]">
            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-4 p-4 border-b border-gray-800 bg-gray-900/30">
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Elapsed Time</p>
                  <p className="text-sm font-mono text-gray-300">{elapsedTime}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Terminal className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Current Stage</p>
                  <p className="text-sm font-mono text-gray-300 truncate">{STAGES[currentStage]?.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Check className="w-4 h-4 text-gray-500" />
                <div>
                  <p className="text-[10px] text-gray-500 uppercase">Cache Status</p>
                  <p className="text-sm font-mono text-gray-300">
                    {cacheHit === true ? <span className="text-green-400">🟢 Hit</span> : cacheHit === false ? <span className="text-yellow-400">🟡 Miss</span> : '⚪ Pending'}
                  </p>
                </div>
              </div>
            </div>

            {/* Terminal Console */}
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-gray-300">
              {logs.map((log, i) => (
                <div key={i} className="mb-1.5 flex gap-3 hover:bg-white/5 px-2 py-0.5 rounded transition-colors">
                  <span className="text-gray-600 select-none">[{log.time}]</span>
                  <span className={log.message?.includes('Cache HIT') ? 'text-green-400' : log.message?.includes('Failed') ? 'text-red-400' : 'text-gray-300'}>
                    {log.message}
                  </span>
                </div>
              ))}
              
              {error && (
                <div className="mt-4 p-3 bg-red-950/40 border border-red-900 rounded text-red-400">
                  <span className="font-bold">Pipeline Error:</span> {error}
                </div>
              )}
              
              {isSuccess && (
                <div className="mt-4 p-3 bg-green-950/40 border border-green-900 rounded text-green-400">
                  <span className="font-bold">Success:</span> Review completed successfully. Transitioning...
                </div>
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Action Bar */}
            {error && (
              <div className="p-4 border-t border-gray-800 bg-gray-900/50 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 rounded bg-gray-800 text-gray-300 text-sm font-medium hover:bg-gray-700 transition-colors">
                  Cancel
                </button>
                <button onClick={onRetry} className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                  Retry Review
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewPipelineOverlay;
