import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_SESSION_SECONDS = 30 * 60; // 30 minutes

export function useWorkspaceTimer(repoId, token, baseUrl) {
  const [workspaceInfo, setWorkspaceInfo] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(null); // null = not yet loaded
  const [isExpired, setIsExpired] = useState(false);

  const timerRef = useRef(null);
  // Track whether the countdown was ever > 0 since data loaded (prevents false-positive on mount)
  const wasActiveRef = useRef(false);
  // Track whether we've done the initial data load
  const loadedRef = useRef(false);

  const fetchWorkspace = useCallback(async () => {
    if (!repoId || !token || !baseUrl) return;
    try {
      const res = await fetch(`${baseUrl}/api/repo/${repoId}/workspace-status`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspaceInfo(data);
        loadedRef.current = true;

        // If backend already says WARNING/EXPIRED on load → show popup immediately
        if (data.status === 'WARNING' || data.status === 'EXPIRED') {
          setIsExpired(true);
        }
      }
    } catch (error) {
      console.error('Failed to fetch workspace status:', error);
    }
  }, [repoId, token, baseUrl]);

  // Initial fetch on mount or repo change
  useEffect(() => {
    // ALWAYS completely reset state when repoId changes
    setWorkspaceInfo(null);
    setRemainingSeconds(null);
    setIsExpired(false);
    wasActiveRef.current = false;
    loadedRef.current = false;
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!repoId) return;

    fetchWorkspace();
  }, [repoId, fetchWorkspace]);

  // Countdown interval — derived entirely from lastActivity
  useEffect(() => {
    // Clear any running timer when lastActivity changes
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!workspaceInfo?.lastActivity) {
      setRemainingSeconds(null);
      return;
    }

    const calculateRemaining = () => {
      const elapsedSeconds = (Date.now() - new Date(workspaceInfo.lastActivity).getTime()) / 1000;
      const remaining = Math.max(0, Math.floor(MAX_SESSION_SECONDS - elapsedSeconds));

      setRemainingSeconds(remaining);

      if (remaining > 0) {
        // Timer is running — mark it as "was active" so we can detect the real expiry
        wasActiveRef.current = true;
        // If it was previously expired (e.g. user clicked Continue Working), clear expiry
        setIsExpired(false);
      } else if (wasActiveRef.current && remaining === 0) {
        // Timer just ticked down to zero while user was on the page → genuine expiry
        setIsExpired(true);
      }
      // If wasActiveRef is false and remaining === 0, this is initial load with expired session
      // — the fetchWorkspace above already handles this via backend status check
    };

    // Run immediately then every second
    calculateRemaining();
    timerRef.current = setInterval(calculateRemaining, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [workspaceInfo?.lastActivity]);

  const refreshTimer = useCallback(async () => {
    // Reset expiry state and refetch fresh data
    setIsExpired(false);
    wasActiveRef.current = false;
    await fetchWorkspace();
  }, [fetchWorkspace]);

  const formatRemainingTime = (seconds) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return {
    workspaceInfo,
    remainingSeconds: remainingSeconds ?? 0,
    formattedTime: formatRemainingTime(remainingSeconds),
    isExpired, // true only when genuinely expired (not on refresh)
    refreshTimer,
  };
}
