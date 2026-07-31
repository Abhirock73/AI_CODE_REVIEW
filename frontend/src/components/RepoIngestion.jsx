import { apiFetch } from '../utils/api';
import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import {
  FolderGit2, Loader2, RefreshCw, GitFork, CheckCircle2,
  Globe, Star, AlertCircle, ArrowRight, Layers, GitBranch, Lock } from 'lucide-react';

const STEP_IDLE = 'idle';
const STEP_DETECTING = 'detecting';
const STEP_DETECTED = 'detected';
const STEP_FORKING = 'forking';
const STEP_CLONING = 'cloning';

const StepBadge = ({ label, status }) => {
  const base = 'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border';
  if (status === 'done') return <span className={`${base} bg-green-500/15 text-green-400 border-green-500/30`}><CheckCircle2 size={11} />{label}</span>;
  if (status === 'active') return <span className={`${base} bg-blue-500/15 text-blue-400 border-blue-500/30`}><Loader2 size={11} className="animate-spin" />{label}</span>;
  return <span className={`${base} bg-gray-700/40 text-gray-500 border-gray-700`}>{label}</span>;
};

const RepoIngestion = ({ onIngest }) => {
  const [activeTab, setActiveTab] = useState('github');
  const [githubUrl, setGithubUrl] = useState('');
  const [zipFile, setZipFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');

  const [step, setStep] = useState(STEP_IDLE);
  const [detected, setDetected] = useState(null);
  const [stepMessage, setStepMessage] = useState('');

  const [userRepos, setUserRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [userReposFetched, setUserReposFetched] = useState(false);

  
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  const fetchUserRepos = async () => {
    setReposLoading(true);
    try {
      const res = await apiFetch(`${BASE_URL}/api/github/repos`, {
        
      });
      const data = await res.json();
      setUserRepos(res.ok && data.repos ? data.repos : []);
      setUserReposFetched(true);
    } catch {
      setUserRepos([]);
      setUserReposFetched(true);
    } finally {
      setReposLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'github' && token) fetchUserRepos();
  }, [activeTab, token]);

  useEffect(() => {
    setDetected(null);
    setStep(STEP_IDLE);
    setError(null);
  }, [githubUrl]);

  const callImport = async (urlToImport, extraMeta = {}) => {
    setStep(STEP_CLONING);
    setStepMessage('Cloning repository into workspace...');
    const response = await apiFetch(`${BASE_URL}/api/github/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlToImport }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Import failed');

    const repo = data.repo || {
      _id: data.storagePath,
      name: data.repoName,
      metadata: { tree: data.tree, languageStats: data.languageStats, storagePath: data.storagePath } };
    if (extraMeta.repoType) {
      repo.metadata = { ...(repo.metadata || {}), ...extraMeta };
    }
    onIngest(repo);
  };

  const handleDetect = async (e, customUrl = null) => {
    if (e) e.preventDefault();
    const urlToCheck = customUrl || githubUrl;
    if (!urlToCheck) return;
    if (customUrl) setGithubUrl(customUrl);

    setError(null);
    setDetected(null);
    setStep(STEP_DETECTING);
    setStepMessage('Checking repository ownership...');

    try {
      const res = await apiFetch(`${BASE_URL}/api/github/detect-repo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToCheck }) });
      const data = await res.json();
      if (!res.ok) { setStep(STEP_IDLE); setError(data.message || 'Failed to detect repository'); return; }

      setDetected(data);
      setStep(STEP_DETECTED);

      if (data.repoType === 'OWN_REPOSITORY') {
        await callImport(urlToCheck, {
          repoType: 'OWN_REPOSITORY',
          originalOwner: data.repoInfo.owner,
          originalRepo: data.repoInfo.name,
          defaultBranch: data.repoInfo.defaultBranch,
          isFork: false });
      }
    } catch (err) {
      setStep(STEP_IDLE);
      setError(err.message);
    }
  };

  const handleForkAndClone = async () => {
    if (!detected) return;
    setError(null);
    setStep(STEP_FORKING);
    setStepMessage('Forking repository to your GitHub account...');
    try {
      const forkRes = await apiFetch(`${BASE_URL}/api/github/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: detected.repoInfo.owner, repo: detected.repoInfo.name }) });
      const forkData = await forkRes.json();
      if (!forkRes.ok) throw new Error(forkData.message || 'Fork failed');

      setStepMessage(forkData.alreadyExisted ? 'Using your existing fork...' : 'Fork ready! Cloning...');

      await callImport(forkData.fork.clone_url, {
        repoType: 'EXTERNAL_REPOSITORY',
        originalOwner: detected.repoInfo.owner,
        originalRepo: detected.repoInfo.name,
        forkFullName: forkData.fork.full_name,
        defaultBranch: forkData.fork.default_branch || detected.repoInfo.defaultBranch,
        isFork: true });
    } catch (err) {
      setStep(STEP_DETECTED);
      setError(err.message);
    }
  };

  const handleZipSubmit = async (e) => {
    e.preventDefault();
    if (!zipFile) return;
    setIsLoading(true);
    setUploadStatus('Uploading ZIP...');
    setError(null);
    try {
      const formData = new FormData();
      formData.append('repoZip', zipFile);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE_URL}/api/repo/upload`, true);
        xhr.withCredentials = true;
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100;
            if (percentComplete >= 100) {
              setUploadStatus('Uploading to Cloudinary...');
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadStatus('Upload Successful');
            const data = JSON.parse(xhr.responseText);
            setTimeout(() => {
              onIngest(data.repo);
            }, 1000);
            resolve();
          } else {
            let errorMsg = 'Upload Failed';
            try {
              errorMsg = JSON.parse(xhr.responseText).message || JSON.parse(xhr.responseText).error || errorMsg;
            } catch (e) {}
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(formData);
      });
    } catch (err) {
      setUploadStatus('Upload Failed');
      setError(err.message);
    } finally {
      setIsLoading(false);
      // Don't reset uploadStatus immediately so they can see success/fail message
      setTimeout(() => setUploadStatus(''), 2000);
    }
  };

  const isWorking = [STEP_DETECTING, STEP_FORKING, STEP_CLONING].includes(step);

  const getStepStatus = (s) => {
    if (step === STEP_DETECTING) return s === 'detect' ? 'active' : 'pending';
    if (step === STEP_DETECTED) return s === 'detect' ? 'done' : 'pending';
    if (step === STEP_FORKING) return s === 'detect' ? 'done' : s === 'fork' ? 'active' : 'pending';
    if (step === STEP_CLONING) return s === 'clone' ? 'active' : 'done';
    return 'pending';
  };

  return (
    <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 overflow-hidden max-w-lg w-full">
      <div className="flex border-b border-gray-700">
        {['github', 'zip'].map((tab) => (
          <button
            key={tab}
            className={`flex-1 py-3 px-4 font-semibold text-sm transition-colors ${
              activeTab === tab ? 'bg-gray-700 text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:bg-gray-700/50'
            }`}
            onClick={() => { setActiveTab(tab); setStep(STEP_IDLE); setDetected(null); setError(null); }}
          >
            {tab === 'github' ? 'Import from GitHub' : 'Upload ZIP File'}
          </button>
        ))}
      </div>

      <div className="p-6">
        {error && (
          <div className="flex items-start gap-2.5 bg-red-500/10 text-red-400 border border-red-500/20 p-3 rounded-lg mb-4 text-sm">
            <AlertCircle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        {activeTab === 'github' && (
          <div className="space-y-5">
            <form onSubmit={handleDetect} className="space-y-3">
              <div>
                <label className="block text-gray-400 mb-1 text-sm font-medium">GitHub Repository URL</label>
                <input
                  type="url" required placeholder="https://github.com/owner/repo"
                  className="w-full p-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm transition-colors"
                  value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} disabled={isWorking}
                />
              </div>

              {/* Detection result card */}
              {detected && step !== STEP_IDLE && (
                <div className="rounded-lg border border-gray-700 overflow-hidden">
                  <div className={`px-4 py-3 flex items-center justify-between border-b ${
                    detected.repoType === 'OWN_REPOSITORY' ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'
                  }`}>
                    <div className="flex items-center gap-2">
                      {detected.repoType === 'OWN_REPOSITORY'
                        ? <CheckCircle2 size={15} className="text-green-400" />
                        : <Globe size={15} className="text-amber-400" />}
                      <span className={`text-sm font-semibold ${detected.repoType === 'OWN_REPOSITORY' ? 'text-green-400' : 'text-amber-400'}`}>
                        {detected.repoType === 'OWN_REPOSITORY' ? 'âœ“ Your Repository' : 'ðŸŒ External Repository'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Star size={11} />{detected.repoInfo.starCount?.toLocaleString() ?? 0}
                      <GitFork size={11} />{detected.repoInfo.forkCount?.toLocaleString() ?? 0}
                    </div>
                  </div>
                  <div className="bg-gray-900/60 px-4 py-3">
                    <p className="text-sm text-white font-medium">{detected.repoInfo.fullName}</p>
                    {detected.repoInfo.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{detected.repoInfo.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><GitBranch size={10} />{detected.repoInfo.defaultBranch}</span>
                      {detected.repoInfo.private && <span className="flex items-center gap-1"><Lock size={10} />Private</span>}
                    </div>
                  </div>
                  {detected.repoType === 'EXTERNAL_REPOSITORY' && (
                    <div className="px-4 py-2.5 bg-gray-900/40 border-t border-gray-700/40 flex items-center gap-1 flex-wrap">
                      <StepBadge label="Detect" status="done" />
                      <ArrowRight size={10} className="text-gray-600" />
                      <StepBadge label="Fork" status={getStepStatus('fork')} />
                      <ArrowRight size={10} className="text-gray-600" />
                      <StepBadge label="Clone" status={getStepStatus('clone')} />
                      <ArrowRight size={10} className="text-gray-600" />
                      <StepBadge label="Commit â†’ Push â†’ PR" status={getStepStatus('edit')} />
                    </div>
                  )}
                </div>
              )}

              {/* Status message */}
              {isWorking && stepMessage && (
                <div className="flex items-center gap-2 text-blue-400 text-sm bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
                  <Loader2 size={14} className="animate-spin shrink-0" />{stepMessage}
                </div>
              )}

              {/* Detect button - shown when no detection yet */}
              {step === STEP_IDLE && (
                <button type="submit" disabled={!githubUrl}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold p-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                  <Layers size={16} />Analyze Repository
                </button>
              )}

              {step === STEP_DETECTING && (
                <button type="button" disabled
                  className="w-full bg-blue-600 opacity-70 cursor-not-allowed text-white font-semibold p-2.5 rounded-lg text-sm flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />Analyzing...
                </button>
              )}

              {/* Fork button - shown only for external repos after detection */}
              {detected && detected.repoType === 'EXTERNAL_REPOSITORY' && !isWorking && (
                <button type="button" onClick={handleForkAndClone}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold p-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
                  <GitFork size={16} />Fork & Clone Repository
                </button>
              )}
            </form>

            {/* User repos list */}
            {userReposFetched && userRepos.length > 0 && step === STEP_IDLE && (
              <div className="border-t border-gray-700 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                    <FolderGit2 size={14} className="text-blue-400" /> Your GitHub Repositories ({userRepos.length})
                  </span>
                  <button onClick={fetchUserRepos} disabled={reposLoading} className="text-xs text-gray-400 hover:text-white transition-colors">
                    <RefreshCw size={12} className={reposLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {userRepos.map((repo) => (
                    <div key={repo.id} className="flex items-center justify-between p-2.5 bg-gray-900/70 border border-gray-700/60 rounded-lg hover:border-blue-500/40 transition-colors">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-semibold text-gray-200 truncate">{repo.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{repo.html_url}</p>
                      </div>
                      <button type="button" onClick={(e) => handleDetect(e, repo.clone_url || repo.html_url)} disabled={isWorking}
                        className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 rounded text-xs transition-colors shrink-0">
                        Import
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'zip' && (
          <form onSubmit={handleZipSubmit} className="space-y-4">
            <div>
              <label className="block text-gray-400 mb-1 text-sm font-medium">Repository ZIP File</label>
              <input type="file" accept=".zip" required
                className="w-full p-2 bg-gray-900 border border-gray-600 rounded-lg text-gray-300 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600 cursor-pointer"
                onChange={(e) => setZipFile(e.target.files[0])} />
            </div>
            <button type="submit" disabled={isLoading || !zipFile}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold p-2.5 rounded-lg transition-colors text-sm flex items-center justify-center gap-2">
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : null}
              <span>{uploadStatus || 'Upload Repository'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default RepoIngestion;

