import { apiFetch } from '../utils/api';
import React, { useState } from 'react';
import { Timer, Download, Loader2, Trash2 } from 'lucide-react';
import { useSelector } from 'react-redux';
import { useToast } from '../contexts/ToastContext';

const SessionExpirationModal = ({ isOpen, repo, onClose, onCleaned }) => {
  const [downloadState, setDownloadState] = useState('');
  const [closingWorkspace, setClosingWorkspace] = useState(false);
  const { addToast } = useToast();
  
    const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!repo?._id) return;
    setDownloadState('Initializing backup...');
    try {
      const res = await apiFetch(`${BASE_URL}/api/repo/${repo._id}/download`, {
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
      
      // Delete workspace after successful download
      await apiFetch(`${BASE_URL}/api/repo/${repo._id}/workspace`, {
        method: 'DELETE' });
      
      setDownloadState('');
      onCleaned();
    } catch (error) {
      addToast(error.message || 'Workspace downloaded, but cleanup failed.', 'error');
      setDownloadState('');
    }
  };

  const handleExtendWorkspace = async () => {
    if (!repo?._id) return;
    try {
      await apiFetch(`${BASE_URL}/api/repo/${repo._id}/workspace/ping`, {
        method: 'POST' });
      onClose();
    } catch (error) {
      console.error('Failed to extend workspace:', error);
    }
  };

  const handleCloseWorkspace = async () => {
    if (!repo?._id) return;
    setClosingWorkspace(true);
    try {
      await apiFetch(`${BASE_URL}/api/repo/${repo._id}/workspace`, {
        method: 'DELETE' });
      
      setClosingWorkspace(false);
      onCleaned();
    } catch (error) {
      addToast('Failed to close workspace', 'error');
      setClosingWorkspace(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-gray-900 border border-yellow-500/30 rounded-2xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden">
        
        <div className="absolute top-0 left-0 w-full h-1 bg-yellow-500 animate-pulse"></div>
        <div className="flex items-center gap-4 mb-4 mt-2">
          <div className="p-3 bg-yellow-500/10 text-yellow-500 rounded-full shrink-0">
            <Timer size={32} />
          </div>
          <h3 className="text-2xl font-bold text-white">Workspace Session Expired</h3>
        </div>
        <p className="text-gray-300 mb-8 leading-relaxed">
          Your temporary workspace has expired due to inactivity.
          <br/><br/>
          Please download your updated repository before leaving, or discard the workspace.
          <br/><br/>
          After this process, you will be redirected to the Import Repository page.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleDownload}
            disabled={!!downloadState || closingWorkspace}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg disabled:opacity-50"
          >
            {downloadState ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
            {downloadState || '📥 Download Updated ZIP'}
          </button>
          <div className="flex gap-3">
            <button 
              onClick={handleExtendWorkspace}
              disabled={!!downloadState || closingWorkspace}
              className="flex-1 px-4 py-3 rounded-xl font-bold bg-gray-800 hover:bg-gray-700 text-white transition-colors disabled:opacity-50"
            >
              Continue Working
            </button>
            <button 
              onClick={handleCloseWorkspace}
              disabled={!!downloadState || closingWorkspace}
              className="flex-1 px-4 py-3 rounded-xl font-bold bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors border border-red-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {closingWorkspace ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {closingWorkspace ? 'Discarding...' : 'Discard Workspace'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionExpirationModal;
