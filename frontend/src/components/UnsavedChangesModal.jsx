import React, { useState } from 'react';
import { AlertTriangle, GitCommit, FileArchive, X, Loader2 } from 'lucide-react';

const UnsavedChangesModal = ({ 
  isOpen, 
  onClose, 
  onDiscard, 
  onSave, 
  repositoryType, 
  pendingAction 
}) => {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setLoading(true);
    await onSave();
    setLoading(false);
  };

  const handleDiscard = async () => {
    setLoading(true);
    await onDiscard();
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-yellow-500/50 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-gray-800 bg-yellow-500/10 flex items-center justify-between">
          <div className="flex items-center gap-2 text-yellow-500 font-bold text-base">
            <AlertTriangle size={18} />
            <span>Unsaved Changes</span>
          </div>
          <button onClick={onClose} disabled={loading} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4 text-sm text-gray-300">
          <p>
            You have unsaved changes in your workspace. If you {pendingAction}, these changes will be lost.
          </p>
          <p>What would you like to do?</p>
        </div>

        <div className="px-6 py-4 border-t border-gray-800 bg-gray-950 flex flex-wrap justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          
          <button
            onClick={handleDiscard}
            disabled={loading}
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            Discard
          </button>

          {repositoryType === 'github' ? (
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <GitCommit size={14} />}
              Save Workspace (Commit & Push)
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
              Save Workspace (Backup ZIP)
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnsavedChangesModal;
