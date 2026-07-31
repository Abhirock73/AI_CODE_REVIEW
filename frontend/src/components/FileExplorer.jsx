import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, File, FileCode, FileText, Image as ImageIcon, LayoutDashboard } from 'lucide-react';

const FileIcon = ({ name }) => {
  const ext = name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'go':
    case 'rs':
    case 'html':
    case 'css':
      return <FileCode size={16} className="text-blue-400" />;
    case 'md':
    case 'txt':
    case 'json':
      return <FileText size={16} className="text-gray-400" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
      return <ImageIcon size={16} className="text-purple-400" />;
    default:
      return <File size={16} className="text-gray-400" />;
  }
};

const TreeNode = ({ node, level = 0, onFileClick, selectedFile }) => {
  const [isOpen, setIsOpen] = useState(level < 1); // Auto open root levels
  const isDir = node.type === 'directory';
  const isSelected = !isDir && selectedFile === node.path;

  return (
    <div className="select-none">
      <div 
        className={`flex items-center py-1 px-2 cursor-pointer rounded transition-colors ${
          isSelected
            ? 'bg-blue-600/30 text-blue-300'
            : 'hover:bg-gray-700/50'
        } ${level === 0 ? 'font-semibold' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (isDir) {
            setIsOpen(!isOpen);
          } else if (onFileClick) {
            onFileClick(node.path);
          }
        }}
      >
        <div className="mr-1 w-4 h-4 flex items-center justify-center">
          {isDir ? (
            isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />
          ) : null}
        </div>
        
        <div className="mr-2">
          {isDir ? (
            <Folder size={16} className="text-yellow-500 fill-yellow-500/20" />
          ) : (
            <FileIcon name={node.name} />
          )}
        </div>
        
        <span className={`text-sm ${isDir ? 'text-gray-200' : isSelected ? 'text-blue-300' : 'text-gray-400'}`}>
          {node.name}
        </span>
      </div>
      
      {isDir && isOpen && node.children && (
        <div>
          {node.children.map((child, idx) => (
            <TreeNode key={`${child.path}-${idx}`} node={child} level={level + 1} onFileClick={onFileClick} selectedFile={selectedFile} />
          ))}
        </div>
      )}
    </div>
  );
};

const FileExplorer = ({ repo, onFileClick, selectedFile, onDashboardClick }) => {
  if (!repo || !repo.metadata || !repo.metadata.tree) {
    return <div className="text-gray-500 text-sm italic">No repository data available.</div>;
  }

  const { tree, languageStats } = repo.metadata;

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700 w-64 shrink-0">
      {/* Dashboard link at top */}
      <button
        onClick={onDashboardClick}
        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b border-gray-700 transition-colors w-full text-left ${
          !selectedFile
            ? 'text-blue-400 bg-blue-500/10'
            : 'text-gray-400 hover:text-blue-400 hover:bg-blue-500/5'
        }`}
      >
        <LayoutDashboard size={14} />
        Dashboard
      </button>

      <div className="p-3 border-b border-gray-700/60">
        <h2 className="font-semibold text-gray-200 truncate text-sm" title={repo.name}>
          {repo.name}
        </h2>
        {languageStats && Object.keys(languageStats).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(languageStats).slice(0, 3).map(([lang]) => (
              <span key={lang} className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">
                {lang}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-700">
        {tree.map((node, idx) => (
          <TreeNode key={`${node.path}-${idx}`} node={node} onFileClick={onFileClick} selectedFile={selectedFile} />
        ))}
      </div>
    </div>
  );
};

export default FileExplorer;
