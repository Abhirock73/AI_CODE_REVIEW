import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { 
  Code2, Shield, Zap, FileText, Play, Server, Clock, 
  CheckCircle2, Circle, Cloud, Database, Trash2, 
  RefreshCw, GitBranch, FolderArchive, Check, Loader2, Timer, Download, X
} from 'lucide-react';
import ReviewPipelineOverlay from './ReviewPipelineOverlay';
import { useToast } from '../contexts/ToastContext';
const COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#f87171', '#fbbf24', '#38bdf8', '#fb923c'];

const GlassCard = ({ children, className = '' }) => (
  <div className={`bg-gray-900/40 backdrop-blur-md border border-gray-700/50 rounded-2xl shadow-xl transition-all duration-300 hover:shadow-2xl hover:border-gray-600/50 hover:-translate-y-1 ${className}`}>
    {children}
  </div>
);

const QualityDashboard = ({ repo, latestReview, onRefresh, onFileSelect, isHistoryView, workspaceStatus, workspaceInfo, remainingSeconds, formattedTime, onRestoreComplete, onCleaned }) => {
  const token = useSelector((state) => state.auth.token);
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';
  const navigate = useNavigate();

  const [isReviewing, setIsReviewing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('Generating AI Review...');
  const { addToast } = useToast();
  
  // Download ZIP State
  const [downloadState, setDownloadState] = useState('');
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [closingWorkspace, setClosingWorkspace] = useState(false);

  // Pipeline Overlay State
  const [showPipeline, setShowPipeline] = useState(false);
  const [pipelineLogs, setPipelineLogs] = useState([]);
  const [pipelineError, setPipelineError] = useState(null);
  const [pipelineSuccess, setPipelineSuccess] = useState(false);

  // Computed Metadata
  const isGitHub = repo?.url?.includes('github.com');
  const owner = isGitHub ? repo.url.split('/')[3] : 'Local User';
  const branch = isGitHub ? 'main' : 'master';
  const langStats = repo?.metadata?.languageStats || {};
  const langData = Object.entries(langStats).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
  const totalFiles = Object.values(langStats).reduce((a, b) => a + b, 0) || 124; // fallback
  const totalFolders = repo?.metadata?.folders || Math.floor(totalFiles / 6) || 18;
  const repoSize = repo?.metadata?.size || '9.2 MB';

  const securityIssues = latestReview?.reviewData?.securityIssues || [];
  const securityData = [
    { name: 'High', value: securityIssues.filter(s => s.severity?.toLowerCase() === 'high').length, fill: '#ef4444' },
    { name: 'Medium', value: securityIssues.filter(s => s.severity?.toLowerCase() === 'medium').length, fill: '#f59e0b' },
    { name: 'Low', value: securityIssues.filter(s => s.severity?.toLowerCase() === 'low').length, fill: '#22c55e' },
  ].filter(d => d.value > 0);

  const score = latestReview?.reviewData?.score ?? null;

  const handleFullRepoReview = async () => {
    if (!repo) return;
    setIsReviewing(true);
    setShowPipeline(true);
    setPipelineLogs([]);
    setPipelineError(null);
    setPipelineSuccess(false);
    setProgressMsg('Initializing Review...');

    const eventSource = new EventSource(`${BASE_URL}/api/ai/review-progress/${repo._id}?token=${token}`);
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.message) {
          setProgressMsg(data.message);
          const now = new Date();
          const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
          setPipelineLogs(prev => [...prev, { time, message: data.message }]);
        }
      } catch (err) {}
    };

    try {
      const res = await fetch(`${BASE_URL}/api/ai/review-repo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ repositoryId: repo._id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Review request failed');
      
      setPipelineSuccess(true);
      addToast(data.message, 'success');
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error('Full repo review error:', err);
      setPipelineError(err.message);
      addToast(err.message, 'error');
    } finally {
      setIsReviewing(false);
      eventSource.close();
      setProgressMsg('Generating AI Review...');
    }
  };

  const handleClosePipeline = () => {
    setShowPipeline(false);
  };

  const handleDownload = async () => {
    if (!repo?._id || !token) return;
    setDownloadState('Generating ZIP...');
    try {
      const res = await fetch(`${BASE_URL}/api/repo/${repo._id}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to get backup URL');
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `repo-${repo._id}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      
      if (!isGitHub) {
        try {
          await fetch(`${BASE_URL}/api/repo/${repo._id}/workspace`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          });
          localStorage.removeItem('ai_review_current_repo');
          setDownloadState('');
          if (onCleaned) onCleaned();
        } catch (err) {
          addToast('Workspace downloaded, but cleanup failed.', 'error');
        }
      } else {
        setShowCleanupModal(true);
      }
    } catch (error) {
      addToast(error.message, 'error');
    } finally {
      setDownloadState('');
    }
  };

  const handleCloseWorkspace = async () => {
    if (!repo?._id || !token) return;
    setClosingWorkspace(true);
    try {
      await fetch(`${BASE_URL}/api/repo/${repo._id}/workspace`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowCleanupModal(false);
      localStorage.removeItem('ai_review_current_repo');
      
      setClosingWorkspace(false);
      if (onCleaned) onCleaned();
    } catch (error) {
      addToast('Failed to close workspace', 'error');
      setClosingWorkspace(false);
    }
  };

  const handleExtendWorkspace = async () => {
    if (!repo?._id || !token) return;
    try {
      await fetch(`${BASE_URL}/api/repo/${repo._id}/workspace/ping`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (onRestoreComplete) onRestoreComplete();
    } catch (error) {}
  };

  if (!repo) {
    return (
      <div className="flex-1 p-8 bg-[#0a0a0a] flex flex-col gap-6 animate-pulse">
        <div className="h-48 bg-gray-900 rounded-2xl w-full" />
        <div className="grid grid-cols-4 gap-6"><div className="h-32 bg-gray-900 rounded-2xl" /><div className="h-32 bg-gray-900 rounded-2xl" /><div className="h-32 bg-gray-900 rounded-2xl" /><div className="h-32 bg-gray-900 rounded-2xl" /></div>
      </div>
    );
  }

  return (
    <>
      <ReviewPipelineOverlay 
        isOpen={showPipeline} repo={repo} logs={pipelineLogs} error={pipelineError} 
        isSuccess={pipelineSuccess} onClose={handleClosePipeline} onRetry={handleFullRepoReview} 
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-gradient-to-br from-[#0a0a0a] to-[#111827] text-gray-200">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">

          <GlassCard className="p-6 md:p-8 border-t-4 border-t-blue-500 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-start gap-5">
              <div className="p-4 bg-gray-800/80 rounded-xl">
                {isGitHub ? <GitBranch size={32} className="text-white" /> : <FolderArchive size={32} className="text-white" />}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-3xl font-bold text-white tracking-tight">{repo.name}</h1>
                  <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-gray-800 text-gray-300 rounded-full border border-gray-700">
                    {isGitHub ? 'GitHub' : 'ZIP Upload'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-400">
                  <div className="flex items-center gap-1.5"><span className="text-gray-500">Owner</span> <span className="text-gray-200">{owner}</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-gray-500">Branch</span> <span className="text-blue-400 font-mono">{branch}</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-gray-500">Files</span> <span className="text-gray-200">{totalFiles}</span></div>
                  <div className="flex items-center gap-1.5"><span className="text-gray-500">Size</span> <span className="text-gray-200">{repoSize}</span></div>
                  <div className="flex items-center gap-1.5"><Database size={14} className="text-green-400" /> <span className="text-green-400">Ready</span></div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 w-full md:w-auto">
              {!isHistoryView && (
                <>
                  <div className="flex flex-col sm:flex-row gap-3 w-full">
                    <button
                      onClick={handleFullRepoReview}
                      disabled={isReviewing}
                      className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold transition-all shadow-lg hover:shadow-blue-500/25"
                    >
                      {isReviewing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
                      {isReviewing ? 'Running Review...' : 'Run AI Review'}
                    </button>
                    <button
                      onClick={() => {
                        if (!latestReview || isReviewing) return;
                        try {
                          import('../utils/pdfGenerator').then(({ generateReviewPDF }) => {
                            generateReviewPDF(repo, latestReview);
                          });
                        } catch (err) {
                          addToast('Unable to generate PDF. Please try again.', 'error');
                        }
                      }}
                      disabled={!latestReview || isReviewing}
                      title={!latestReview ? "Generate a review to enable PDF download." : ""}
                      className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:bg-gray-800 disabled:text-gray-500 disabled:hover:bg-gray-800 text-white font-semibold transition-all shadow-lg border border-transparent disabled:border-gray-700"
                    >
                      <FileText size={18} />
                      Download Review (PDF)
                    </button>
                  </div>
                  {!isGitHub && (
                    <div className="flex flex-col sm:flex-row gap-3 w-full mt-3">
                      <button
                        onClick={handleDownload}
                        disabled={!!downloadState}
                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold transition-all shadow-lg border border-gray-700"
                      >
                        {downloadState ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                        {downloadState || '📥 Download Updated ZIP'}
                      </button>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2">
                <button onClick={onRefresh} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors border border-gray-700">
                  <RefreshCw size={14} /> Refresh
                </button>
                <button onClick={() => setShowCleanupModal(true)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-colors border border-red-500/20">
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </GlassCard>

          {workspaceStatus === 'EXPIRED' || !workspaceInfo || workspaceInfo.status === 'EXPIRED' ? (
            <div className="w-full mt-6 bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center flex flex-col items-center justify-center">
              <FolderArchive size={48} className="text-red-400 mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Workspace Expired</h2>
              <p className="text-gray-400 mb-6 max-w-md">
                This repository's temporary workspace has expired and been deleted to free up server resources.
              </p>
            </div>
          ) : (
            <>
              {workspaceInfo && (
                <div className="mb-6 mt-6">
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">Workspace Lifecycle</h2>
              
              {(workspaceInfo.status === 'WARNING' || workspaceInfo.status === 'CLEANING') && isGitHub && (
                <div className={`mb-4 px-4 py-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${workspaceInfo.status === 'CLEANING' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500'}`}>
                  <div className="flex items-center gap-3">
                    <Timer className="animate-pulse" size={20} />
                    <div>
                      <h3 className="font-bold text-sm">{workspaceInfo.status === 'CLEANING' ? 'Cleanup in Progress' : 'Session Expiring Soon'}</h3>
                      <p className="text-xs opacity-80">
                        {workspaceInfo.status === 'CLEANING' 
                          ? 'This workspace is currently being deleted or archived due to inactivity.'
                          : 'Your workspace has been inactive. Please save or commit your changes before it is automatically cleaned up.'}
                      </p>
                    </div>
                  </div>
                  {workspaceInfo.status === 'WARNING' && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={handleExtendWorkspace} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-yellow-500 text-yellow-950 hover:bg-yellow-400 transition-colors">
                        Continue Working
                      </button>
                      <button onClick={() => setShowCleanupModal(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-yellow-500/30 hover:bg-yellow-500/10 transition-colors">
                        Close Repository
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <GlassCard className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Status</p>
                    <div className="flex items-center gap-2">
                      <Circle size={10} className={workspaceInfo.status === 'ACTIVE' ? 'text-green-400 fill-green-400' : workspaceInfo.status === 'WARNING' ? 'text-yellow-400 fill-yellow-400' : 'text-red-400 fill-red-400'} />
                      <span className="text-sm font-semibold text-white">{workspaceInfo.status}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Time Remaining</p>
                    <span className="text-lg font-mono text-gray-200">{formattedTime}</span>
                  </div>
                </GlassCard>

                <GlassCard className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Cloud / Git</p>
                    <div className="flex items-center gap-2">
                      {isGitHub ? <GitBranch size={14} className="text-blue-400" /> : <Cloud size={14} className="text-blue-400" />}
                      <span className="text-sm font-semibold text-gray-200">{isGitHub ? 'GitHub Sync' : 'Local Archive'}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Last Activity</p>
                    <span className="text-xs text-gray-300">{new Date(workspaceInfo.lastActivity).toLocaleTimeString()}</span>
                  </div>
                </GlassCard>

                <GlassCard className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Workspace State</p>
                    <div className="flex items-center gap-2">
                      {workspaceInfo.dirty ? <Circle size={10} className="text-yellow-500 fill-yellow-500" /> : <CheckCircle2 size={12} className="text-green-500" />}
                      <span className="text-sm font-semibold text-gray-200">{workspaceInfo.dirty ? 'Unsaved Changes' : 'Clean'}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Size</p>
                    <span className="text-sm font-mono text-gray-300">{repoSize}</span>
                  </div>
                </GlassCard>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
            <GlassCard className="p-5 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-yellow-500/10 rounded-lg"><Zap size={20} className="text-yellow-400" /></div>
                {score !== null ? (
                  <span className="px-2 py-1 text-[10px] uppercase font-bold bg-green-500/10 text-green-400 rounded">Analyzed</span>
                ) : (
                  <span className="px-2 py-1 text-[10px] uppercase font-bold bg-gray-800 text-gray-400 rounded">Waiting</span>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider">Quality Score</p>
                {score !== null ? (
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold text-white">{score}</span><span className="text-sm text-gray-500">/ 100</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-2">No Quality Score Yet</p>
                )}
              </div>
            </GlassCard>

            <GlassCard className="p-5 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-red-500/10 rounded-lg"><Shield size={20} className="text-red-400" /></div>
                {latestReview ? (
                  <span className="px-2 py-1 text-[10px] uppercase font-bold bg-blue-500/10 text-blue-400 rounded">Scanned</span>
                ) : (
                  <span className="px-2 py-1 text-[10px] uppercase font-bold bg-gray-800 text-gray-400 rounded">Pending</span>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider">Security Issues</p>
                {latestReview ? (
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold text-white">{securityIssues.length}</span><span className="text-sm text-gray-500">Found</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-2">Not Scanned Yet</p>
                )}
              </div>
            </GlassCard>

            <GlassCard className="p-5 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-purple-500/10 rounded-lg"><FileText size={20} className="text-purple-400" /></div>
                {latestReview ? (
                  <span className="px-2 py-1 text-[10px] uppercase font-bold bg-blue-500/10 text-blue-400 rounded">Generated</span>
                ) : (
                  <span className="px-2 py-1 text-[10px] uppercase font-bold bg-gray-800 text-gray-400 rounded">Pending</span>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider">Suggestions</p>
                {latestReview ? (
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold text-white">{latestReview.reviewData?.suggestions?.length || 0}</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-2">Pending Analysis</p>
                )}
              </div>
            </GlassCard>

            <GlassCard className="p-5 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-blue-500/10 rounded-lg"><Code2 size={20} className="text-blue-400" /></div>
                <span className="px-2 py-1 text-[10px] uppercase font-bold bg-green-500/10 text-green-400 rounded">Detected</span>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider">Languages</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-white">{Object.keys(langStats).length}</span><span className="text-sm text-gray-500">Detected</span>
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <div className="lg:col-span-2 space-y-6">
              
              {!latestReview && (
                <GlassCard className="p-6 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 transition-all group-hover:bg-blue-500/20" />
                  <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-green-400" /> Repository Health & Pipeline Preview
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3"><CheckCircle2 size={16} className="text-green-500" /><span className="text-sm text-gray-300">Repository Imported Successfully</span></div>
                      <div className="flex items-center gap-3"><CheckCircle2 size={16} className="text-green-500" /><span className="text-sm text-gray-300">Languages & Files Detected</span></div>
                      <div className="flex items-center gap-3"><CheckCircle2 size={16} className="text-green-500" /><span className="text-sm text-gray-300">Cloud Storage Uploaded</span></div>
                      <div className="flex items-center gap-3"><CheckCircle2 size={16} className="text-green-500" /><span className="text-sm text-gray-300">Redis Cache Initialized</span></div>
                    </div>
                    <div className="border-l-2 border-gray-800 pl-6 space-y-4">
                      <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">Upcoming AI Pipeline</div>
                      <div className="flex items-center gap-3 opacity-60"><Circle size={12} className="text-blue-400" /><span className="text-sm text-gray-400">Generate Fingerprint</span></div>
                      <div className="flex items-center gap-3 opacity-60"><Circle size={12} className="text-blue-400" /><span className="text-sm text-gray-400">Check Cache / Analyze Chunks</span></div>
                      <div className="flex items-center gap-3 opacity-60"><Circle size={12} className="text-blue-400" /><span className="text-sm text-gray-400">Security & Suggestion Scan</span></div>
                      <div className="flex items-center gap-3 opacity-60"><Circle size={12} className="text-blue-400" /><span className="text-sm text-gray-400">Generate Final Report</span></div>
                    </div>
                  </div>
                </GlassCard>
              )}

              <GlassCard className="p-6">
                <h3 className="text-lg font-semibold text-white mb-6">Language Distribution</h3>
                {langData.length > 0 ? (
                  <div className="flex flex-col md:flex-row items-center gap-8">
                    <div className="w-48 h-48 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={langData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                            {langData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px', color: '#e5e7eb' }} itemStyle={{ color: '#e5e7eb' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 w-full space-y-4">
                      {langData.slice(0, 5).map((l, i) => {
                        const pct = Math.round((l.value / totalFiles) * 100);
                        const color = COLORS[i % COLORS.length];
                        return (
                          <div key={l.name}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-300 font-medium flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}></span>{l.name}
                              </span>
                              <span className="text-gray-500">{l.value} files ({pct}%)</span>
                            </div>
                            <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm">No language data available.</div>
                )}
              </GlassCard>

              {latestReview && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <GlassCard className="p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">Security Findings</h3>
                    {securityData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={securityData} barSize={32}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                          <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: '#1f2937' }} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '12px' }} />
                          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                            {securityData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-[200px] text-green-400 text-sm gap-2 bg-green-500/5 rounded-xl border border-green-500/10">
                        <CheckCircle2 size={32} />
                        <span>No security vulnerabilities detected!</span>
                      </div>
                    )}
                  </GlassCard>

                  <GlassCard className="p-6 flex flex-col">
                    <h3 className="text-lg font-semibold text-white mb-4">Top AI Suggestions</h3>
                    {latestReview.reviewData?.suggestions?.length > 0 ? (
                      <div className="space-y-3 overflow-y-auto pr-2 flex-1 max-h-[200px] custom-scrollbar">
                        {latestReview.reviewData.suggestions.map((s, i) => {
                          const isObj = typeof s === 'object' && s !== null;
                          const issueText = isObj ? s.issue : s;
                          const suggestionText = isObj ? s.suggestion : null;
                          const file = isObj ? s.file : null;
                          const clickable = file && onFileSelect;
                          
                          return (
                            <div 
                              key={i} 
                              onClick={() => clickable && onFileSelect(file)}
                              className={`flex gap-3 text-sm bg-gray-800/50 p-3 rounded-xl transition-colors border border-gray-700/50 ${clickable ? 'cursor-pointer hover:bg-gray-700 hover:border-purple-500/50' : 'hover:bg-gray-800'}`}
                            >
                              <span className="text-purple-400 font-mono text-xs mt-0.5 shrink-0">{String(i+1).padStart(2, '0')}</span>
                              <div className="flex-1">
                                <span className="text-gray-300 leading-relaxed font-medium block">{issueText}</span>
                                {suggestionText && <span className="text-gray-500 text-xs mt-1 block">{suggestionText}</span>}
                                {file && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-mono mt-2 bg-gray-900/50 inline-flex px-2 py-1 rounded">
                                    <Code2 className="w-3 h-3" />
                                    <span>{file}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-500 text-sm">No suggestions provided.</div>
                    )}
                  </GlassCard>
                </div>
              )}

              {latestReview && securityIssues.length > 0 && (
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Shield className="text-red-400 w-5 h-5" /> Detailed Security Report</h3>
                  <div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                    {securityIssues.map((issue, idx) => {
                      const clickable = issue.file && onFileSelect;
                      return (
                        <div 
                          key={idx} 
                          onClick={() => clickable && onFileSelect(issue.file)}
                          className={`bg-gray-950 p-4 rounded-xl border border-gray-800 flex items-start gap-4 transition-colors ${clickable ? 'cursor-pointer hover:border-red-500/50 hover:bg-gray-900/80' : 'hover:border-red-500/30'}`}
                        >
                          <div className={`mt-1 shrink-0 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                            issue.severity === 'high' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                            issue.severity === 'medium' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 
                            'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          }`}>
                            {issue.severity || 'Issue'}
                          </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-gray-200 mb-1">{issue.title || 'Security Warning'}</h4>
                          {issue.description && (
                            <p className="text-xs text-gray-400 mb-2 leading-relaxed">{issue.description}</p>
                          )}
                          {(issue.file || issue.line) && (
                            <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono bg-gray-900 px-2 py-1 rounded inline-flex">
                              <Code2 className="w-3 h-3" />
                              <span>{issue.file || 'unknown'}</span>
                              {issue.line && (
                                <>
                                  <span className="text-gray-700">|</span>
                                  <span className="text-gray-400">Line {issue.line}</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </GlassCard>
              )}
            </div>

            <div className="space-y-6">
              
              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Repository Details</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between border-b border-gray-800 pb-2"><span className="text-gray-500">Source</span> <span className="text-gray-200">{isGitHub ? 'GitHub API' : 'ZIP Upload'}</span></div>
                  <div className="flex justify-between border-b border-gray-800 pb-2"><span className="text-gray-500">Default Branch</span> <span className="text-blue-400 font-mono">{branch}</span></div>
                  <div className="flex justify-between border-b border-gray-800 pb-2"><span className="text-gray-500">Visibility</span> <span className="text-gray-200">{isGitHub ? 'Public' : 'Private'}</span></div>
                  <div className="flex justify-between border-b border-gray-800 pb-2"><span className="text-gray-500">Total Folders</span> <span className="text-gray-200">{totalFolders}</span></div>
                  <div className="flex justify-between pb-1"><span className="text-gray-500">Upload Date</span> <span className="text-gray-200">{new Date(repo.createdAt).toLocaleDateString()}</span></div>
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Cloud size={16} /> Cloud Storage</h3>
                <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 bg-blue-500 h-full"></div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-300 font-medium">Provider</span>
                    <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-1 rounded">MongoDB</span>
                  </div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-300 font-medium">Status</span>
                    <span className="text-xs text-green-400 flex items-center gap-1"><Check size={12}/> Uploaded</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-800 pt-3 mt-4">
                    <span className="text-xs font-semibold text-gray-400">Auto Cleanup</span>
                    <span className="text-xs font-mono text-yellow-400">{formattedTime}</span>
                  </div>
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Server size={16} /> AI Cache Status</h3>
                <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 bg-green-500 h-full"></div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-300 font-medium">State</span>
                    <span className="text-xs bg-green-500/10 text-green-400 px-2 py-1 rounded font-bold">READY</span>
                  </div>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm text-gray-300 font-medium">TTL (Max)</span>
                    <span className="text-xs text-gray-400 font-mono">24h 00m 00s</span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-3 pt-3 border-t border-gray-800/50 leading-relaxed">
                    Reviews are strictly cached in Redis to prevent rate limiting and optimize pipeline execution times.
                  </p>
                </div>
              </GlassCard>

              {/* Recent Activity */}
              <GlassCard className="p-6">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Clock size={16} /> Recent Activity</h3>
                <div className="space-y-4 pl-2 relative border-l border-gray-800">
                  <div className="relative">
                    <div className="absolute w-2 h-2 bg-blue-500 rounded-full -left-[5px] top-1.5 shadow-[0_0_8px_#3b82f6]"></div>
                    <p className="text-sm text-gray-200 pl-4">Repository Imported</p>
                    <p className="text-xs text-gray-500 pl-4 mt-0.5">{new Date(repo.createdAt).toLocaleString()}</p>
                  </div>
                  {latestReview && (
                    <div className="relative">
                      <div className="absolute w-2 h-2 bg-green-500 rounded-full -left-[5px] top-1.5 shadow-[0_0_8px_#22c55e]"></div>
                      <p className="text-sm text-gray-200 pl-4">AI Review Completed</p>
                      <p className="text-xs text-gray-500 pl-4 mt-0.5">{new Date(latestReview.createdAt).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </GlassCard>
            </div>
          </div>
        </>
      )}
    </div>
    </div>

      {showCleanupModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full shadow-2xl relative">
            <h3 className="text-xl font-bold text-white mb-2">Workspace Cleanup</h3>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
              {workspaceInfo?.dirty 
                ? (isGitHub ? 'You have unsaved changes! Please commit and push your changes to GitHub before closing.' : 'You have unsaved changes! Please download an updated ZIP before closing this workspace, or they will be lost.') 
                : 'Do you want to close this workspace and free server storage?'}
            </p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowCleanupModal(false)}
                disabled={closingWorkspace}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                Keep Workspace
              </button>
              <button 
                onClick={handleCloseWorkspace}
                disabled={closingWorkspace || (workspaceInfo?.dirty && isGitHub)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 disabled:opacity-50"
              >
                {closingWorkspace ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Close Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4b5563; }
      `}} />
    </>
  );
};

export default QualityDashboard;
