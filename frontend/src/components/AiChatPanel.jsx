import React, { useState, useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Bot, Send, User, Loader2, X, MessageSquare } from 'lucide-react';

const MessageBubble = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-blue-600' : 'bg-purple-700'}`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? 'bg-blue-600 text-white rounded-tr-sm'
          : 'bg-gray-800 text-gray-200 rounded-tl-sm border border-gray-700'
      }`}>
        {message.content}
      </div>
    </div>
  );
};

const AiChatPanel = ({ onClose, repo }) => {
  const [messages, setMessages] = useState([
    { role: 'model', content: `Hi! I'm your AI code assistant. I'm familiar with the **${repo?.name || 'current'}** repository. Ask me anything about the architecture, code patterns, or any specific file.` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const token = useSelector((state) => state.auth.token);
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const repoContext = repo
        ? `Repository: ${repo.name}. Languages: ${Object.keys(repo.metadata?.languageStats || {}).join(', ')}.`
        : '';

      const res = await fetch(`${BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: msg,
          repoId: repo?._id || 'general',
          repoContext,
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'model', content: data.reply || 'Sorry, I could not generate a response.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'model', content: 'Failed to connect to the AI service. Please check the backend logs.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed bottom-0 right-0 w-96 h-[600px] flex flex-col bg-gray-900 border border-gray-700 rounded-t-2xl shadow-2xl z-50">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-800 rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">AI Code Assistant</h3>
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {loading && (
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-purple-700 flex items-center justify-center shrink-0">
              <Bot size={14} />
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-tl-sm px-3 py-2">
              <Loader2 size={14} className="animate-spin text-gray-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-none p-3 border-t border-gray-800">
        <div className="flex items-end gap-2 bg-gray-800 rounded-xl border border-gray-700 px-3 py-2">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about the codebase..."
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none max-h-24"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="flex-none p-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-[10px] text-gray-600 text-center mt-1">Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
};

export default AiChatPanel;
