import { apiFetch } from '../utils/api';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { FolderGit2, Calendar, Code2, Shield, ChevronRight, ArrowLeft, Clock } from 'lucide-react';

const COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#f87171', '#fbbf24'];

const ScoreBadge = ({ score }) => {
  if (score === null || score === undefined) return <span className="text-xs text-gray-500">No review</span>;
  const color = score >= 80 ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : score >= 60 ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    : 'bg-red-500/15 text-red-400 border-red-500/30';
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded-full border ${color}`}>
      {score}/100
    </span>
  );
};

const RepoCard = ({ repo, onSelect }) => {
  const langs = Object.keys(repo.metadata?.languageStats || {}).slice(0, 3);
  const date = new Date(repo.createdAt);

  return (
    <div
      onClick={() => onSelect(repo)}
      className="bg-gray-800 border border-gray-700 hover:border-blue-500/50 rounded-xl p-5 cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-500/5 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-gray-900 text-blue-400 shrink-0">
            <FolderGit2 size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white truncate group-hover:text-blue-400 transition-colors">
              {repo.name}
            </h3>
            <p className="text-xs text-gray-500 truncate mt-0.5">{repo.url}</p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <ScoreBadge score={repo.qualityScore} />
          <ChevronRight size={14} className="text-gray-600 group-hover:text-blue-400 transition-colors" />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {langs.map((lang, i) => (
            <span
              key={lang}
              className="text-[10px] px-2 py-0.5 rounded-full border"
              style={{ color: COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length] + '40', background: COLORS[i % COLORS.length] + '10' }}
            >
              {lang}
            </span>
          ))}
          {Object.keys(repo.metadata?.languageStats || {}).length > 3 && (
            <span className="text-[10px] text-gray-500">+{Object.keys(repo.metadata.languageStats).length - 3} more</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-500">
          <Clock size={10} />
          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
    </div>
  );
};

const History = () => {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
    const navigate = useNavigate();
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await apiFetch(`${BASE_URL}/api/history`, {
          
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        setRepos(data.repos || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [token]);

  const handleSelect = (repo) => {
    navigate('/', { state: { preloadedRepo: repo } });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>
        <div className="h-4 w-px bg-gray-700" />
        <h1 className="text-base font-bold text-white flex items-center gap-2">
          <FolderGit2 size={18} className="text-blue-400" />
          Repository History
        </h1>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold text-white">Your Repositories</h2>
            <p className="text-sm text-gray-400 mt-1">
              {loading ? 'Loading...' : `${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'} analyzed`}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 mb-6">
            {error}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl p-5 animate-pulse h-28" />
            ))}
          </div>
        )}

        {!loading && repos.length === 0 && !error && (
          <div className="text-center py-20">
            <FolderGit2 size={48} className="mx-auto mb-4 text-gray-700" />
            <p className="text-gray-400">No repositories analyzed yet.</p>
            <p className="text-sm text-gray-600 mt-1">Import a repository from the dashboard to get started.</p>
            <button
              onClick={() => navigate('/')}
              className="mt-6 px-5 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        )}

        {!loading && repos.length > 0 && (
          <div className="grid grid-cols-1 gap-4">
            {repos.map(repo => (
              <RepoCard key={repo._id} repo={repo} onSelect={handleSelect} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default History;
