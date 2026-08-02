import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Editor from '@monaco-editor/react';
import {
  Save,
  RefreshCw,
  GitCommit,
  UploadCloud,
  DownloadCloud,
  Download,
  AlertTriangle,
  Zap,
  Code,
  Loader2,
  Edit3,
  Eye,
  History,
  FileText,
  GitBranch,
  PlusCircle,
  MinusCircle,
  FileDiff,
  CheckCircle,
  XCircle,
  Clock,
  Award } from 'lucide-react';


const LANGUAGE_MAP = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.md': 'markdown' };

const ComplexityBadge = ({ score }) => {
  if (score === 'N/A' || score === undefined) return null;
  const num = parseInt(score);
  const color =
    num <= 5
      ? 'text-green-400 bg-green-400/10 border-green-500/30'
      : num <= 10
      ? 'text-yellow-400 bg-yellow-400/10 border-yellow-500/30'
      : 'text-red-400 bg-red-400/10 border-red-500/30';
  const label = num <= 5 ? 'Low' : num <= 10 ? 'Moderate' : 'High';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${color}`}>
      <Zap size={11} />
      Complexity: {score} ({label})
    </span>
  );
};

const FileViewer = ({ repoId, repo, selectedFile, isHistoryView, onCodeChange, onReRunReview, latestReview, workspaceStatus, onRestoreComplete }) => {
  const [originalContent, setOriginalContent] = useState(null);
  const [editedContent, setEditedContent] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Top Toolbar & Git State
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [gitActionLoading, setGitActionLoading] = useState(null);
  const [gitStatus, setGitStatus] = useState(null);
  const [toast, setToast] = useState(null);
  // Review History State
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [reviewHistory, setReviewHistory] = useState([]);

  // PR Dialog State
  const [showPRDialog, setShowPRDialog] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prLoading, setPrLoading] = useState(false);
  const [prResult, setPrResult] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

    const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  // Toast Auto-dismiss
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Inactivity Status Poller
  const [inactivityStatus, setInactivityStatus] = useState(null);
  const [showInactivityModal, setShowInactivityModal] = useState(false);

  useEffect(() => {
    if (!repoId) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`${BASE_URL}/api/repo/${repoId}/workspace-status`, {
          });
        const data = await res.json();
        setInactivityStatus(data);
        
        // Show modal if WARNING, dirty, and it's a GitHub repo
        const isGithub = repo && repo.url && repo.url.includes('github');
        if (data.status === 'WARNING' && data.dirty && isGithub) {
          setShowInactivityModal(true);
        } else {
          setShowInactivityModal(false);
        }
      } catch (err) {
        console.error('Failed to poll workspace status', err);
      }
    }, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [repoId, BASE_URL, repo]);

  // Fetch Git Status
  const fetchGitStatus = async () => {
    if (!repoId) return;
    try {
      const res = await apiFetch(`${BASE_URL}/api/github/status?repoId=${repoId}`, {
        
      });
      const data = await res.json();
      if (data.gitStatus) {
        setGitStatus(data.gitStatus);
      }
    } catch {
      // ignore
    }
  };

  // Fetch Review History
  const fetchReviewHistory = async () => {
    if (!repoId) return;
    setHistoryLoading(true);
    try {
      const res = await apiFetch(`${BASE_URL}/api/history/${repoId}`, {
        
      });
      const data = await res.json();
      setReviewHistory(data.reviews || []);
    } catch {
      setReviewHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Reset & load on file change
  useEffect(() => {
    setOriginalContent(null);
    setEditedContent(null);
    setAnalysis(null);
    setIsDirty(false);
    setFetchError(null);
    if (onCodeChange) onCodeChange(null);
  }, [selectedFile, repoId]);

  useEffect(() => {
    if (!selectedFile || !repoId) return;

    const fetchFile = async () => {
      if (isHistoryView) {
        const msg = '// File content in Read-Only Mode.\n// Return to current repo to edit.';
        setOriginalContent(msg);
        setEditedContent(msg);
        if (onCodeChange) onCodeChange(msg);
        return;
      }

      setLoading(true);
      setFetchError(null);
      try {
        const res = await apiFetch(
          `${BASE_URL}/api/repo/${repoId}/file?path=${encodeURIComponent(selectedFile)}`,
          { }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
          throw new Error(errData.message || `HTTP ${res.status}`);
        }
        const text = await res.text();
        setOriginalContent(text);
        setEditedContent(text);
        if (onCodeChange) onCodeChange(text);
      } catch (err) {
        console.error('FileViewer fetch error:', err);
        setFetchError(err.message);
        setOriginalContent(null);
        setEditedContent(null);
      } finally {
        setLoading(false);
      }
    };

    const fetchAnalysis = async () => {
      setAnalysisLoading(true);
      try {
        const res = await apiFetch(
          `${BASE_URL}/api/repo/${repoId}/file/analysis?path=${encodeURIComponent(selectedFile)}`,
          { }
        );
        const data = await res.json();
        setAnalysis(data);
      } catch {
        setAnalysis(null);
      } finally {
        setAnalysisLoading(false);
      }
    };

    fetchFile();
    fetchAnalysis();
    fetchGitStatus();
  }, [selectedFile, repoId]);

  // Auto-save interval
  useEffect(() => {
    const timer = setInterval(() => {
      if (isDirty && editedContent !== originalContent) {
        handleSave(true);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [isDirty, editedContent, originalContent, selectedFile, repoId]);

  const handleEditorChange = (value) => {
    setEditedContent(value);
    setIsDirty(value !== originalContent);
    if (onCodeChange) onCodeChange(value);
  };

  // --- TOP TOOLBAR HANDLERS --- //

  // 1. Save
  const handleSave = async (isAutoSave = false) => {
    if (!selectedFile || !repoId) return;
    if (!isAutoSave) setSaving(true);
    try {
      const res = await apiFetch(`${BASE_URL}/api/projects/${repoId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: editedContent }) });
      const data = await res.json();
      if (res.ok) {
        setOriginalContent(editedContent);
        setIsDirty(false);
        if (!isAutoSave) setToast({ type: 'success', message: 'File saved successfully to workspace' });
        fetchGitStatus();
      } else {
        if (!isAutoSave) setToast({ type: 'error', message: data.error || 'Failed to save file' });
      }
    } catch (err) {
      if (!isAutoSave) setToast({ type: 'error', message: err.message });
    } finally {
      if (!isAutoSave) setSaving(false);
    }
  };

  // 2. Re-run Review
  const handleReRunReviewAction = async () => {
    if (!repoId) return;
    setReviewing(true);
    try {
      if (onReRunReview) {
        await onReRunReview();
      }
      setToast({ type: 'success', message: 'Re-run analysis & AI review completed' });
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to re-run review' });
    } finally {
      setReviewing(false);
    }
  };

  const handleDiscardWorkspace = async () => {
    try {
      await apiFetch(`${BASE_URL}/api/repo/${repoId}/workspace`, {
        method: 'DELETE' });
      setShowInactivityModal(false);
      window.location.reload(); 
    } catch (err) {
      console.error(err);
    }
  };

  // 3. Commit
  const handleCommit = async () => {
    if (!repoId) return;
    const msg = prompt('Enter commit message:', `Update ${selectedFile || 'project files'}`);
    if (msg === null) return;
    setGitActionLoading('commit');
    try {
      const res = await apiFetch(`${BASE_URL}/api/github/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId, message: msg }) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: `Committed: ${data.commitHash ? data.commitHash.slice(0, 7) : 'Staged changes'}` });
        fetchGitStatus();
      } else {
        setToast({ type: 'error', message: data.error || 'Commit failed' });
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setGitActionLoading(null);
    }
  };

  // 4. Push
  const handlePush = async () => {
    if (!repoId) return;
    setGitActionLoading('push');
    try {
      const res = await apiFetch(`${BASE_URL}/api/github/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId }) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Pushed changes to GitHub successfully!' });
        fetchGitStatus();
      } else {
        setToast({ type: 'error', message: data.error || 'Push failed' });
        if (data.error && data.error.includes('Repository changed on GitHub')) {
          alert(`⚠️ Push Blocked:\n\n${data.error}\n\nPlease click "Pull" to fetch remote changes first.`);
        }
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setGitActionLoading(null);
    }
  };

  // 5. Pull
  const handlePull = async () => {
    if (!repoId) return;
    setGitActionLoading('pull');
    try {
      const res = await apiFetch(`${BASE_URL}/api/github/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId }) });
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'success', message: 'Pulled latest changes from GitHub!' });
        fetchGitStatus();
      } else {
        setToast({ type: 'error', message: data.error || 'Pull failed' });
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    } finally {
      setGitActionLoading(null);
    }
  };

  // 6. Create Pull Request
  const handleOpenPRDialog = () => {
    const repoMeta = repo?.metadata || {};
    const aiSummary = latestReview?.reviewData?.summary || '';
    const lastCommitMsg = gitStatus?.latestCommit?.message || '';
    setPrTitle(lastCommitMsg ? `${lastCommitMsg.slice(0, 72)}` : `Contribution from ${repoMeta.forkFullName || 'fork'}`);
    setPrBody(aiSummary ? `## AI Review Summary\n\n${aiSummary}\n\n---\n*Created via AI Code Review*` : '');
    setPrResult(null);
    setShowPRDialog(true);
  };

  const handleSubmitPR = async () => {
    const repoMeta = repo?.metadata || {};
    if (!repoMeta.originalOwner || !repoMeta.originalRepo) {
      setToast({ type: 'error', message: 'Missing original repository info. Cannot create PR.' });
      return;
    }
    setPrLoading(true);
    setPrResult(null);
    try {
      const currentBranch = gitStatus?.currentBranch || repoMeta.defaultBranch || 'main';
      const [forkOwner] = (repoMeta.forkFullName || '').split('/');
      const head = forkOwner ? `${forkOwner}:${currentBranch}` : currentBranch;
      const res = await apiFetch(`${BASE_URL}/api/github/create-pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalOwner: repoMeta.originalOwner,
          originalRepo: repoMeta.originalRepo,
          head,
          base: repoMeta.defaultBranch || 'main',
          title: prTitle,
          body: prBody }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create PR');
      setPrResult({ success: true, pr: data.pr, alreadyExists: data.alreadyExists });
    } catch (err) {
      setPrResult({ success: false, error: err.message });
    } finally {
      setPrLoading(false);
    }
  };

  const handleOpenHistoryModal = () => {
    setShowHistoryModal(true);
    fetchReviewHistory();
  };

  if (!selectedFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 bg-gray-950">
        <div className="text-center">
          <Code size={48} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">Select a file from the explorer to view its contents</p>
        </div>
      </div>
    );
  }

  if (workspaceStatus === 'EXPIRED') {
    return (
      <div className="flex-1 flex flex-col bg-gray-950 overflow-hidden items-center justify-center p-8 text-center">
        <h2 className="text-xl font-bold text-white mb-2">Workspace Expired</h2>
        <p className="text-gray-400 mb-6 max-w-md">
          This repository's temporary workspace has expired and been deleted to free up server resources.
        </p>
      </div>
    );
  }

  const ext = selectedFile.includes('.') ? `.${selectedFile.split('.').pop()}` : '';
  const monacoLanguage = LANGUAGE_MAP[ext] || 'plaintext';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-16 right-6 z-50 px-4 py-2.5 rounded-lg border shadow-xl flex items-center gap-2 text-xs font-medium backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'bg-green-950/80 border-green-500/50 text-green-300'
              : 'bg-red-950/80 border-red-500/50 text-red-300'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* TOP TOOLBAR */}
      <div className="flex-none bg-gray-900 border-b border-gray-800 px-2 sm:px-4 py-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty || isHistoryView}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              isDirty && !isHistoryView
                ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400'
                : 'bg-gray-800 text-gray-400 border-gray-700 opacity-60 cursor-not-allowed'
            }`}
            title="Save file changes (PUT /projects/:id/file)"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            <span>Save</span>
          </button>

          {/* Re-run Review Button */}
          <button
            onClick={handleReRunReviewAction}
            disabled={reviewing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 rounded-md text-xs font-medium transition-colors"
            title="Re-run static & AI code review"
          >
            {reviewing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            <span>Re-run Review</span>
          </button>

          <div className="h-4 w-px bg-gray-800 mx-1" />

          {/* Commit Button */}
          <button
            onClick={handleCommit}
            disabled={gitActionLoading === 'commit'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-md text-xs font-medium transition-colors"
            title="Stage and commit changes (POST /github/commit)"
          >
            {gitActionLoading === 'commit' ? <Loader2 size={13} className="animate-spin" /> : <GitCommit size={13} />}
            <span>Commit</span>
          </button>

          {/* Push Button */}
          <button
            onClick={handlePush}
            disabled={gitActionLoading === 'push'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-green-400 border border-gray-700 rounded-md text-xs font-medium transition-colors"
            title="Push changes to GitHub (POST /github/push)"
          >
            {gitActionLoading === 'push' ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
            <span>Push</span>
          </button>

          {/* Pull Button */}
          <button
            onClick={handlePull}
            disabled={gitActionLoading === 'pull'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-blue-400 border border-gray-700 rounded-md text-xs font-medium transition-colors"
            title="Pull latest changes (POST /github/pull)"
          >
            {gitActionLoading === 'pull' ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
            <span>Pull</span>
          </button>

          <div className="h-4 w-px bg-gray-800 mx-1" />

          {/* Repo Ownership Badge */}
          {repo?.metadata?.repoType && (
            <>
              <div className="h-4 w-px bg-gray-800 mx-1" />
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${
                repo.metadata.repoType === 'OWN_REPOSITORY'
                  ? 'bg-green-500/10 text-green-400 border-green-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {repo.metadata.repoType === 'OWN_REPOSITORY' ? '✓ Own' : '🌍 Fork'}
              </span>
            </>
          )}

          {/* Create PR Button — only for forked repos */}
          {repo?.metadata?.isFork && (
            <button
              onClick={handleOpenPRDialog}
              disabled={isHistoryView}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/40 rounded-md text-xs font-medium transition-colors"
              title="Create Pull Request to original repository"
            >
              <GitBranch size={13} />
              <span>Create PR</span>
            </button>
          )}
        </div>

        {/* Review Version History Button */}
        <button
          onClick={handleOpenHistoryModal}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-md text-xs font-medium transition-colors shrink-0"
        >
          <History size={13} className="text-yellow-400" />
          <span>Review History</span>
        </button>
      </div>

      {/* PR DIALOG MODAL */}
      {showPRDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-auto flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-2">
                <GitBranch size={16} className="text-violet-400" />
                <h3 className="text-sm font-semibold text-white">Create Pull Request</h3>
              </div>
              <button onClick={() => { setShowPRDialog(false); setPrResult(null); }} className="text-gray-500 hover:text-white transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              {repo?.metadata?.originalOwner && repo?.metadata?.originalRepo && (
                <div className="text-xs text-gray-400 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
                  PR target: <span className="text-white font-medium">{repo.metadata.originalOwner}/{repo.metadata.originalRepo}</span>
                  {gitStatus?.currentBranch && <> &nbsp;·&nbsp; branch: <span className="text-violet-300 font-mono">{gitStatus.currentBranch}</span></>}
                </div>
              )}

              {prResult ? (
                <div className={`rounded-lg border p-4 text-sm ${
                  prResult.success
                    ? 'bg-green-500/10 border-green-500/30 text-green-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  {prResult.success ? (
                    <>
                      <p className="font-semibold mb-1">{prResult.alreadyExists ? 'Pull Request already exists!' : '🎉 Pull Request created!'}</p>
                      <a href={prResult.pr.html_url} target="_blank" rel="noopener noreferrer"
                        className="underline text-violet-300 hover:text-violet-200 break-all">
                        {prResult.pr.html_url}
                      </a>
                    </>
                  ) : (
                    <p>{prResult.error}</p>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-medium">PR Title</label>
                    <input
                      type="text" value={prTitle} onChange={(e) => setPrTitle(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
                      placeholder="Describe your changes…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1 font-medium">Description</label>
                    <textarea
                      value={prBody} onChange={(e) => setPrBody(e.target.value)} rows={6}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors resize-none font-mono"
                      placeholder="Describe your changes, motivation, testing…"
                    />
                  </div>
                </>
              )}
            </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-800 shrink-0 mt-4">
              <button onClick={() => { setShowPRDialog(false); setPrResult(null); }}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
                {prResult ? 'Close' : 'Cancel'}
              </button>
              {!prResult && (
                <button onClick={handleSubmitPR} disabled={prLoading || !prTitle}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors">
                  {prLoading ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
                  {prLoading ? 'Creating PR…' : 'Create Pull Request'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GIT STATUS BAR & FILE INFO */}
      <div className="flex-none bg-gray-900/60 border-b border-gray-800 px-4 py-1.5 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono text-gray-300">
            {isHistoryView ? <Eye size={13} /> : <Edit3 size={13} className="text-blue-400" />}
            <span>{selectedFile}</span>
            {isDirty && !isHistoryView && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                Unsaved
              </span>
            )}
          </div>
        </div>

        {/* GIT STATUS BREAKDOWN */}
        <div className="flex items-center gap-4">
          {gitStatus?.isRepo ? (
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1 text-gray-400" title="Active Branch">
                <GitBranch size={12} className="text-blue-400" />
                {gitStatus.currentBranch || 'main'}
              </span>
              <span className="flex items-center gap-1 text-yellow-400" title="Modified files">
                <FileDiff size={12} />
                Modified: {gitStatus.modifiedCount || 0}
              </span>
              <span className="flex items-center gap-1 text-green-400" title="Added files">
                <PlusCircle size={12} />
                Added: {gitStatus.createdCount || 0}
              </span>
              <span className="flex items-center gap-1 text-red-400" title="Deleted files">
                <MinusCircle size={12} />
                Deleted: {gitStatus.deletedCount || 0}
              </span>
            </div>
          ) : (
            <span className="text-gray-500 italic text-[11px]">Git status unavailable</span>
          )}

          {analysisLoading ? (
            <Loader2 size={13} className="animate-spin text-gray-400" />
          ) : analysis ? (
            <ComplexityBadge score={analysis.complexity} />
          ) : null}
        </div>
      </div>

      {/* Static Analysis Warnings */}
      {!analysisLoading && analysis?.warnings?.length > 0 && (
        <div className="flex-none bg-yellow-500/5 border-b border-yellow-500/20 px-4 py-1.5 space-y-1">
          {analysis.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* MONACO EDITOR CANVAS */}
      <div className="flex-1 overflow-hidden relative">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <Loader2 size={24} className="animate-spin mr-2" />
            <span>Loading file in Monaco Editor...</span>
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <AlertTriangle size={40} className="text-yellow-500 opacity-60" />
            <div>
              <p className="text-sm font-semibold text-gray-300 mb-1">File not found</p>
              <p className="text-xs text-gray-500 max-w-sm">
                Re-upload or re-clone repository to restore file contents.
              </p>
            </div>
            <code className="text-xs bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-red-400">
              {fetchError}
            </code>
          </div>
        ) : (
          <Editor
            height="100%"
            language={monacoLanguage}
            value={editedContent ?? ''}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly: isHistoryView,
              fontFamily: 'Consolas, "Fira Code", Monaco, monospace' }}
          />
        )}
      </div>

             {/* REVIEW VERSION HISTORY MODAL */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl mx-auto flex flex-col max-h-[90vh]">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-800 shrink-0 flex justify-between items-center bg-gray-900/50">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <History size={18} className="text-blue-400" /> Review History
              </h2>
              <button onClick={() => setShowHistoryModal(false)} className="text-gray-500 hover:text-white transition-colors">
                <XCircle size={20} />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto bg-gray-950 flex-1">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-500">
                  <Loader2 size={24} className="animate-spin mr-2" />
                  <span>Fetching review history...</span>
                </div>
              ) : reviewHistory.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText size={36} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No past reviews found for this repository.</p>
                </div>
              ) : (
                reviewHistory.map((rev, idx) => (
                  <div key={rev._id || idx} className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Award size={16} className="text-blue-400" />
                        <span className="text-sm font-semibold text-white">Version #{reviewHistory.length - idx}</span>
                        {rev.score && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold">
                            Score: {rev.score}/100
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400 font-mono">
                        <Clock size={12} />
                        <span>{new Date(rev.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    {rev.summary && (
                      <p className="text-xs text-gray-300 leading-relaxed bg-gray-900/50 p-2.5 rounded border border-gray-800">
                        {rev.summary}
                      </p>
                    )}

                    {rev.refactoring?.length > 0 && (
                      <div className="text-xs text-yellow-300/90 space-y-1">
                        <span className="font-semibold text-gray-400">Key Suggestions:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-300">
                          {rev.refactoring.slice(0, 3).map((item, i) => (
                            <li key={i}>{typeof item === 'string' ? item : item.issue || item.suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-800 bg-gray-950 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* INACTIVITY WARNING MODAL */}
      {showInactivityModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-yellow-500/50 rounded-xl w-full max-w-lg shadow-2xl mx-auto flex flex-col max-h-[90vh]">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-800 bg-yellow-500/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-yellow-500 font-bold text-base">
                <AlertTriangle size={18} />
                <span>Session Expiring Soon</span>
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-4 text-sm text-gray-300 overflow-y-auto">
              <p>
                Your workspace has been inactive and will be <strong className="text-white">deleted in {Math.round((inactivityStatus?.remainingTime || 0) / 60000)} minutes</strong>.
              </p>
              <p>
                You have unsaved changes. What would you like to do?
              </p>
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-gray-800 bg-gray-950 flex flex-wrap justify-end gap-2 sm:gap-3 shrink-0">
              <button
                onClick={handleDiscardWorkspace}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-sm font-medium transition-colors"
              >
                Discard Changes
              </button>
              <button
                onClick={() => { setShowInactivityModal(false); setShowPRDialog(true); }}
                className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded text-sm font-medium transition-colors"
              >
                Create Pull Request
              </button>
              <button
                onClick={() => { setShowInactivityModal(false); handleCommit(); }}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
              >
                <GitCommit size={14} /> Commit & Push
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileViewer;
