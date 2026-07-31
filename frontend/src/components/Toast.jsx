import React, { useEffect, useState, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

const Toast = ({ toast }) => {
  const { removeToast } = useToast();
  const [isClosing, setIsClosing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // Trigger entry animation shortly after mount
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Auto-hide after 3 seconds
    timerRef.current = setTimeout(() => {
      setIsClosing(true);
    }, 3000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isClosing) {
      setIsVisible(false);
      // Allow animation to finish before removing from state
      const closeTimer = setTimeout(() => {
        removeToast(toast.id);
      }, 300); // 300ms matches the transition duration
      return () => clearTimeout(closeTimer);
    }
  }, [isClosing, removeToast, toast.id]);

  let bgClass = 'bg-gray-800 text-white border-gray-700';
  let Icon = Info;
  let iconColor = 'text-blue-400';

  switch (toast.type) {
    case 'success':
      bgClass = 'bg-green-500/10 text-green-400 border-green-500/30';
      Icon = CheckCircle2;
      iconColor = 'text-green-400';
      break;
    case 'error':
      bgClass = 'bg-red-500/10 text-red-400 border-red-500/30';
      Icon = XCircle;
      iconColor = 'text-red-400';
      break;
    case 'warning':
      bgClass = 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30';
      Icon = AlertTriangle;
      iconColor = 'text-yellow-500';
      break;
    case 'info':
      bgClass = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      Icon = Info;
      iconColor = 'text-blue-400';
      break;
    default:
      break;
  }

  return (
    <div
      className={`flex items-center gap-3 px-6 py-3 rounded-xl border shadow-2xl transition-all duration-300 transform ${bgClass} ${
        isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
      }`}
    >
      <Icon size={18} className={iconColor} />
      <span className="text-sm font-medium">{toast.message}</span>
    </div>
  );
};

export default Toast;
