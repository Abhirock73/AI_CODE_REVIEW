import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { setNodeHealth, setAiHealth } from './store';
import { logout } from './features/authSlice';
import Login from './pages/Login';
import Signup from './pages/Signup';
import History from './pages/History';
import GithubCallback from './pages/GithubCallback';
import RepoIngestion from './components/RepoIngestion';
import FileExplorer from './components/FileExplorer';
import FileViewer from './components/FileViewer';
import AiReviewPanel from './components/AiReviewPanel';
import AiChatPanel from './components/AiChatPanel';
import QualityDashboard from './components/QualityDashboard';
import UnsavedChangesModal from './components/UnsavedChangesModal';
import SessionExpirationModal from './components/SessionExpirationModal';
import { useWorkspaceTimer } from './hooks/useWorkspaceTimer';

import { FolderCode, LogOut, MessageSquare, History as HistoryIcon, LayoutDashboard, ChevronRight, FolderSync } from 'lucide-react';

const LANGUAGE_MAP = {
  '.js': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.json': 'json', '.html': 'html', '.css': 'css',
};

const LS_REPO_KEY = 'ai_review_current_repo';

function Dashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { nodeHealth, aiHealth } = useSelector((state) => state.health);
  const { user, isAuthenticated, token } = useSelector((state) => state.auth);

  // Restore repo from location.state or localStorage on mount
  const [currentRepo, setCurrentRepo] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_REPO_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [historyRepo, setHistoryRepo] = useState(() => {
    if (location.state?.preloadedRepo) {
      return location.state.preloadedRepo;
    }
    return null;
  });
  
  const displayRepo = historyRepo || currentRepo;
  const isHistoryView = !!historyRepo;

  const [selectedFile, setSelectedFile] = useState(null);
  const [editedCode, setEditedCode] = useState(null);
  const [latestReview, setLatestReview] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  // Global Workspace State powered by custom hook
  const { workspaceInfo, remainingSeconds, formattedTime, isExpired, refreshTimer } = useWorkspaceTimer(displayRepo?._id, token, BASE_URL);
  const isDirty = workspaceInfo?.dirty || false;
  const workspaceStatus = workspaceInfo?.status || 'ACTIVE';

  const [pendingAction, setPendingAction] = useState(null); // 'logout', 'switch', 'history'

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Handle pre-loaded repo from History page navigation
  useEffect(() => {
    if (location.state?.preloadedRepo) {
      const repo = location.state.preloadedRepo;
      setHistoryRepo(repo);
      setSelectedFile(null);
      setEditedCode(null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Persist currentRepo to localStorage whenever it changes
  useEffect(() => {
    try {
      if (currentRepo) {
        localStorage.setItem(LS_REPO_KEY, JSON.stringify(currentRepo));
      } else {
        localStorage.removeItem(LS_REPO_KEY);
      }
    } catch {}
  }, [currentRepo]);

  // Fetch repo data (tree and latest review) when displayRepo._id changes
  useEffect(() => {
    if (!displayRepo?._id) {
      setLatestReview(null);
      return;
    }

    const loadRepoData = async () => {
      setLatestReview(null); // Clear previous review immediately to avoid flashes
      try {
        const res = await fetch(`${BASE_URL}/api/history/${displayRepo._id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        
        // 1. Update latest review by fetching the complete review using its reviewId
        if (data.reviews?.[0]?._id) {
          try {
            const reviewRes = await fetch(`${BASE_URL}/api/reviews/${data.reviews[0]._id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (reviewRes.ok) {
              const reviewData = await reviewRes.json();
              setLatestReview(reviewData.review);
            } else {
              setLatestReview(data.reviews[0]);
            }
          } catch (err) {
            setLatestReview(data.reviews[0]);
          }
        } else {
          setLatestReview(null);
        }

        // 2. If the displayRepo state is missing the tree but the fetched data has it, update it
        if (!displayRepo.metadata?.tree && data.repo?.metadata?.tree) {
          if (historyRepo) setHistoryRepo(data.repo);
          else setCurrentRepo(data.repo);
        }
      } catch (err) {
        console.error('Failed to load repo data:', err);
      }
    };

    loadRepoData();
  }, [displayRepo?._id, token, BASE_URL]);

  useEffect(() => {
    const fetchHealth = async (url, action) => {
      try {
        const r = await fetch(url);
        dispatch(action(await r.json()));
      } catch (e) {
        dispatch(action({ status: 'error', message: e.message }));
      }
    };
    fetchHealth(`${BASE_URL}/api/health`, setNodeHealth);
    fetchHealth(`${BASE_URL}/api/ai/health`, setAiHealth);
  }, [dispatch, BASE_URL]);

  // Reset editedCode when the selected file changes (FileViewer will reload fresh content)
  useEffect(() => {
    setEditedCode(null);
  }, [selectedFile, displayRepo?._id]);

  const fetchLatestReview = async () => {
    if (!currentRepo?._id) return;
    try {
      const res = await fetch(`${BASE_URL}/api/history/${currentRepo._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.reviews?.[0]?._id) {
        const reviewRes = await fetch(`${BASE_URL}/api/reviews/${data.reviews[0]._id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (reviewRes.ok) {
          const reviewData = await reviewRes.json();
          setLatestReview(reviewData.review);
        } else {
          setLatestReview(data.reviews[0]);
        }
      } else {
        setLatestReview(null);
      }
    } catch { setLatestReview(null); }
  };

  const executePendingAction = (action) => {
    const act = action || pendingAction;
    if (act === 'logout') {
      localStorage.removeItem(LS_REPO_KEY);
      dispatch(logout());
    } else if (act === 'switch') {
      localStorage.removeItem(LS_REPO_KEY);
      setCurrentRepo(null);
      setSelectedFile(null);
      setEditedCode(null);
    } else if (act === 'history') {
      navigate('/history');
    }
    setPendingAction(null);
  };

  const handleLogout = () => {
    if (isDirty) {
      setPendingAction('logout');
    } else {
      executePendingAction('logout');
    }
  };

  const handleSwitchRepo = () => {
    if (isDirty) {
      setPendingAction('switch');
    } else {
      executePendingAction('switch');
    }
  };

  const handleHistoryNav = () => {
    if (isDirty) {
      setPendingAction('history');
    } else {
      executePendingAction('history');
    }
  };

  const handleModalSave = async () => {
    if (!displayRepo) return;
    const isGithub = displayRepo.url?.includes('github');
    try {
      let res;
      if (isGithub) {
        res = await fetch(`${BASE_URL}/api/github/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ repoId: displayRepo._id, message: 'Auto-save before closing' }),
        });
      } else {
        res = await fetch(`${BASE_URL}/api/repo/${displayRepo._id}/workspace/backup`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.reason || data.error || 'Failed to save workspace');
      }
      
      setIsDirty(false);
      executePendingAction();
    } catch (err) {
      console.error('Failed to save workspace:', err.message);
      alert(`Upload Failed: ${err.message}`);
    }
  };

  const handleModalDiscard = async () => {
    if (!displayRepo) return;
    try {
      await fetch(`${BASE_URL}/api/repo/${displayRepo._id}/workspace`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      setIsDirty(false);
      executePendingAction();
    } catch (err) {
      console.error('Failed to discard workspace', err);
    }
  };

  const handleIngest = (repo) => {
    setCurrentRepo(repo);
    setSelectedFile(null);
    setEditedCode(null);
  };

  const goToDashboard = () => setSelectedFile(null);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const nodeOk = nodeHealth?.status === 'ok';
  const aiOk = aiHealth?.status === 'ok';
  const selectedExt = selectedFile ? `.${selectedFile.split('.').pop()}` : '';
  const selectedLang = LANGUAGE_MAP[selectedExt] || 'unknown';

  return (
    <div className="flex h-screen bg-gray-950 text-gray-200 overflow-hidden font-sans">
      {/* Sidebar: File Explorer */}
      {displayRepo ? (
        <FileExplorer
          repo={displayRepo}
          selectedFile={selectedFile}
          onFileClick={setSelectedFile}
          onDashboardClick={goToDashboard}
        />
      ) : (
        <div className="w-64 border-r border-gray-800 bg-gray-900/30 flex flex-col items-center justify-center text-gray-500 p-6 text-center">
          <FolderCode size={40} className="mb-4 opacity-20" />
          <p className="text-sm">Upload a repository to view its files</p>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <FolderCode size={20} className="text-blue-400" />
            <h1 className="text-base font-bold text-white">AI Code Review</h1>
            {selectedFile && displayRepo && (
              <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-gray-800 rounded-md border border-gray-700">
                <button
                  onClick={goToDashboard}
                  className="text-xs text-gray-400 hover:text-blue-400 transition-colors truncate max-w-[150px]"
                >
                  {displayRepo.name}
                </button>
                <ChevronRight size={12} className="text-gray-500" />
                <span className="text-xs text-blue-300 font-mono truncate max-w-[300px]">
                  {selectedFile}
                </span>
              </div>
            )}
            {isHistoryView && (
              <button
                onClick={() => { setHistoryRepo(null); setSelectedFile(null); }}
                className="ml-4 px-3 py-1 bg-blue-600 hover:bg-blue-700 transition-colors text-white text-xs font-medium rounded-md shadow-sm border border-blue-500"
              >
                Return to Current Repo
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${nodeOk ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${nodeOk ? 'bg-green-400' : 'bg-red-400'}`} /> API
              </div>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${aiOk ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${aiOk ? 'bg-green-400' : 'bg-red-400'}`} /> AI
              </div>
            </div>
            {displayRepo && (
              <button onClick={handleSwitchRepo} className="text-gray-400 hover:text-white transition-colors" title="Switch Repository">
                <FolderSync size={18} />
              </button>
            )}
            <button onClick={handleHistoryNav} className="text-gray-400 hover:text-white transition-colors" title="Review History">
              <HistoryIcon size={18} />
            </button>
            <button onClick={handleLogout} className="text-gray-400 hover:text-red-400 transition-colors" title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <UnsavedChangesModal 
          isOpen={!!pendingAction}
          onClose={() => setPendingAction(null)}
          onDiscard={handleModalDiscard}
          onSave={handleModalSave}
          repositoryType={displayRepo?.url?.includes('github') ? 'github' : 'zip'}
          pendingAction={pendingAction === 'switch' ? 'close the repository' : pendingAction === 'logout' ? 'log out' : 'navigate away'}
        />

        {/* Center Canvas & AI Review Footer */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          
          {/* Main Editor / Dashboard Area */}
          <div className="flex-1 overflow-y-auto relative">
            {!displayRepo ? (
              <div className="min-h-full flex items-center justify-center p-6">
                <RepoIngestion onIngest={handleIngest} />
              </div>
            ) : selectedFile ? (
              <div className="absolute inset-0 flex flex-col">
                <FileViewer
                  repoId={displayRepo._id}
                  repo={displayRepo}
                  selectedFile={selectedFile}
                  isHistoryView={isHistoryView}
                  onCodeChange={setEditedCode}
                  onReRunReview={fetchLatestReview}
                  latestReview={latestReview}
                  workspaceStatus={workspaceStatus}
                  onRestoreComplete={refreshTimer}
                />
              </div>
            ) : (
              <QualityDashboard
                repo={displayRepo}
                latestReview={latestReview}
                onRefresh={fetchLatestReview}
                onFileSelect={setSelectedFile}
                isHistoryView={isHistoryView}
                workspaceStatus={workspaceStatus}
                workspaceInfo={workspaceInfo}
                remainingSeconds={remainingSeconds}
                formattedTime={formattedTime}
                onRestoreComplete={refreshTimer}
                onCleaned={() => {
                  localStorage.removeItem(LS_REPO_KEY);
                  setCurrentRepo(null);
                  setSelectedFile(null);
                  setEditedCode(null);
                }}
              />
            )}
          </div>

          {/* AI Review Panel (bottom footer) — only when a file is selected */}
          {selectedFile && displayRepo && workspaceStatus !== 'EXPIRED' && (
            <div className="h-72 border-t border-gray-800 bg-gray-900/30 flex flex-col shrink-0 z-10 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]">
              <AiReviewPanel
                repoId={displayRepo._id}
                selectedFile={selectedFile}
                fileContent={editedCode}
                language={selectedLang}
                isHistoryView={isHistoryView}
                onReviewComplete={fetchLatestReview}
              />
            </div>
          )}
        </div>
      </div>

      {/* Floating Chat Button */}
      {displayRepo && !chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-500 rounded-full shadow-xl shadow-blue-900/20 flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 border border-blue-400/30"
        >
          <MessageSquare size={24} />
        </button>
      )}

      {/* Chat Panel Sliding Window */}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 w-[450px] h-[600px] shadow-2xl rounded-2xl overflow-hidden border border-gray-700 bg-gray-900 z-50 flex flex-col transform transition-transform">
          <AiChatPanel repoId={displayRepo?._id} currentFile={selectedFile} onClose={() => setChatOpen(false)} />
        </div>
      )}

      {/* Global Session Expiration Modal for ZIP Uploads — only when GENUINELY expired */}
      <SessionExpirationModal
        isOpen={isExpired && !displayRepo?.url?.includes('github')}
        repo={displayRepo}
        onClose={refreshTimer}
        onCleaned={() => {
          localStorage.removeItem(LS_REPO_KEY);
          setCurrentRepo(null);
          setSelectedFile(null);
          setEditedCode(null);
        }}
      />
    </div>
  );
}

import { ToastProvider } from './contexts/ToastContext';
import ToastContainer from './components/ToastContainer';

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/github/callback" element={<GithubCallback />} />
          <Route path="/history" element={<History />} />
          <Route path="/*" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
      <ToastContainer />
    </ToastProvider>
  );
}

export default App;
