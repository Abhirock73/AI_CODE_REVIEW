import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Sparkles, Shield, Wrench, MessageSquare, ChevronRight, AlertTriangle, CheckCircle, Loader2, Save } from 'lucide-react';

const ScoreBadge = ({ score }) => {
  const color = score >= 80 ? 'text-green-400 border-green-500/40 bg-green-500/10'
    : score >= 60 ? 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10'
    : 'text-red-400 border-red-500/40 bg-red-500/10';
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-lg font-bold ${color}`}>
      <span>{score}</span>
      <span className="text-xs font-normal opacity-70">/ 100</span>
    </div>
  );
};

const Section = ({ title, icon: Icon, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 text-sm font-medium text-gray-200 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-blue-400" />
          {title}
        </div>
        <ChevronRight size={14} className={`text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="p-4 bg-gray-900/60 space-y-2 text-sm text-gray-300">{children}</div>}
    </div>
  );
};

// Multi-step loading states for Save & Re-Review
const SAVE_STEPS = ['idle', 'saving', 'analyzing', 'persisting', 'done'];
const STEP_LABELS = {
  idle: null,
  saving: 'Saving to disk…',
  analyzing: 'AI analyzing…',
  persisting: 'Saving score…',
  done: 'Done!',
};

const AiReviewPanel = ({ repoId, selectedFile, fileContent, language, onReviewComplete, isHistoryView }) => {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saveStep, setSaveStep] = useState('idle');
  const [error, setError] = useState(null);
  const token = useSelector((state) => state.auth.token);
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  const isSaving = saveStep !== 'idle';

  // Quick AI-only review (no save)
  const runReview = async () => {
    if (!fileContent || isHistoryView) return;
    setLoading(true);
    setError(null);
    setReview(null);
    try {
      const res = await fetch(`${BASE_URL}/api/ai/review-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: fileContent,
          language: language || 'unknown',
          filename: selectedFile,
          repositoryId: repoId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Review failed');
      setReview(data);
      if (onReviewComplete) onReviewComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Full execution chain: Save → AI Review → Persist Score → Refresh
  const saveAndReReview = async () => {
    if (!fileContent || isHistoryView || language === 'unknown') return;
    setError(null);
    setReview(null);

    try {
      // Step 1: Write edited code to disk
      setSaveStep('saving');
      const saveRes = await fetch(`${BASE_URL}/api/repo/${repoId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filePath: selectedFile, newContent: fileContent }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json();
        throw new Error(d.message || 'Failed to save file');
      }

      // Step 2: Run Gemini AI review on the new content
      setSaveStep('analyzing');
      const reviewRes = await fetch(`${BASE_URL}/api/ai/review-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: fileContent,
          language: language || 'unknown',
          filename: selectedFile,
          repositoryId: repoId,
        }),
      });
      const reviewData = await reviewRes.json();
      if (!reviewRes.ok) throw new Error(reviewData.message || 'AI review failed');
      setReview(reviewData);

      // Step 3: Persist AI quality score to MongoDB
      setSaveStep('persisting');
      if (typeof reviewData.score === 'number') {
        await fetch(`${BASE_URL}/api/repo/${repoId}/file`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            filePath: selectedFile,
            newContent: fileContent,
            aiScore: reviewData.score,
          }),
        });
      }

      // Step 4: Refresh QualityDashboard
      setSaveStep('done');
      if (onReviewComplete) onReviewComplete();

      // Reset to idle after a brief "Done!" display
      setTimeout(() => setSaveStep('idle'), 2000);
    } catch (err) {
      setError(err.message);
      setSaveStep('idle');
    }
  };

  const canReview = !!fileContent && !isHistoryView && language !== 'unknown';

  return (
    <div className="w-full h-full flex bg-gray-900 overflow-hidden">
      {/* Left Sidebar: Header, Actions, and Score */}
      <div className="w-72 flex-none flex flex-col border-r border-gray-800 bg-gray-900/50">
        <div className="p-4 border-b border-gray-800 flex-none space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-purple-400" />
            <h3 className="text-sm font-semibold text-gray-200">AI Review</h3>
          </div>

          {selectedFile && (
            <div className="flex flex-col gap-2">
              {/* Save & Re-Review — primary action */}
              <button
                onClick={saveAndReReview}
                disabled={!canReview || isSaving || loading}
                title={
                  isHistoryView ? 'Historical repos are read-only'
                    : language === 'unknown' ? 'Unsupported file type'
                    : 'Save edits to disk then run a full AI review'
                }
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                  saveStep === 'done'
                    ? 'bg-green-600 text-white'
                    : canReview && !isSaving && !loading
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg shadow-purple-900/30'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {STEP_LABELS[saveStep]}
                  </>
                ) : (
                  <>
                    <Save size={13} />
                    Save & Re-Review
                  </>
                )}
              </button>

              {/* Run Review — quick AI-only, no disk write */}
              <button
                onClick={runReview}
                disabled={!canReview || loading || isSaving}
                title={language === 'unknown' ? 'Unsupported file type for AI review' : isHistoryView ? 'Historical repositories are read-only' : 'Run AI review without saving'}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-medium bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 px-3 py-1.5 rounded-lg transition-colors border border-gray-700"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {loading ? 'Analyzing…' : 'Run Review (no save)'}
              </button>
            </div>
          )}
        </div>

        {/* Score Area in the left sidebar */}
        <div className="flex-1 p-4 flex flex-col items-center justify-center text-center overflow-y-auto">
          {review ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Quality Score</p>
              <ScoreBadge score={review.score} />
              <p className="text-xs text-gray-400 mt-2">{review.summary}</p>
            </div>
          ) : !selectedFile ? (
            <p className="text-xs text-gray-500">Select a file and click "Run Review" to get AI-powered analysis.</p>
          ) : (
            <p className="text-xs text-gray-500 opacity-50">Score will appear here</p>
          )}
        </div>
      </div>

      {/* Right Area: Panel Body with Columns */}
      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 custom-scrollbar bg-gray-900">
        {selectedFile && language === 'unknown' && (
          <div className="col-span-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 flex items-start gap-2">
            <AlertTriangle size={13} className="text-yellow-500 mt-0.5 shrink-0" />
            <span>This file type is not supported for AI review. Only code files (JS, TS, Python, etc.) can be analysed.</span>
          </div>
        )}

        {isHistoryView && (
          <div className="col-span-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 flex items-start gap-2">
            <AlertTriangle size={13} className="text-blue-400 mt-0.5 shrink-0" />
            <span>Historical repositories are read-only. Return to the current repo to run reviews.</span>
          </div>
        )}

        {error && (
          <div className="col-span-full bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-400 shadow-xl">
            <span className="font-semibold block mb-1">Error</span>
            {error}
          </div>
        )}

        {review && (
          <>
            {/* Security Column */}
            {review.security?.length > 0 && (
              <div className="w-full">
                <Section title={`Security (${review.security.length})`} icon={Shield}>
                  {review.security.map((s, i) => (
                    <div key={i} className="border-l-2 border-red-500 pl-3 py-1 space-y-1">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${s.severity === 'high' ? 'bg-red-500/20 text-red-400' : s.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-600 text-gray-300'}`}>
                        {s.severity}
                      </span>
                      <p className="text-xs text-gray-300">{s.description}</p>
                      <p className="text-xs text-gray-500 italic">→ {s.suggestion}</p>
                    </div>
                  ))}
                </Section>
              </div>
            )}

            {/* Refactoring Column */}
            {review.refactoring?.length > 0 && (
              <div className="w-full">
                <Section title={`Refactoring (${review.refactoring.length})`} icon={Wrench}>
                  {review.refactoring.map((r, i) => (
                    <div key={i} className="border-l-2 border-blue-500 pl-3 py-1 space-y-1">
                      {r.line && <span className="text-xs text-gray-500">Line {r.line}</span>}
                      <p className="text-xs text-gray-300">{r.issue}</p>
                      <p className="text-xs text-blue-400 italic">→ {r.suggestion}</p>
                    </div>
                  ))}
                </Section>
              </div>
            )}

            {/* Comments Column */}
            {review.comments?.length > 0 && (
              <div className="w-full">
                <Section title="General Comments" icon={MessageSquare} defaultOpen={false}>
                  {review.comments.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
                      <CheckCircle size={12} className="mt-0.5 text-green-500 shrink-0" />
                      <p>{c}</p>
                    </div>
                  ))}
                </Section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AiReviewPanel;
