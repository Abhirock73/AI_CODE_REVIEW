import { apiFetch } from '../utils/api';
import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setCredentials } from '../features/authSlice';
import { Loader2, AlertCircle } from 'lucide-react';

const GithubCallback = () => {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const BASE_URL = import.meta.env.VITE_NODE_API_URL || '';

  useEffect(() => {
    const code = searchParams.get('code');

    const authenticateWithGithub = async () => {
      try {
        if (code) {
          const redirectUri = `${window.location.origin}/github/callback`;
          const response = await apiFetch(`${BASE_URL}/api/auth/github`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, redirect_uri: redirectUri }) });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || data.error || 'GitHub authentication failed');
          }

          dispatch(setCredentials({ user: data.user }));
          navigate('/');
        } else {
          // Backend already handled the OAuth and set the cookie
          const res = await apiFetch(`${BASE_URL}/api/auth/me`);
          if (res.ok) {
            const data = await res.json();
            dispatch(setCredentials({ user: data.user }));
            navigate('/');
          } else {
             throw new Error('Authentication failed');
          }
        }
      } catch (err) {
        console.error('GitHub callback error:', err);
        setError(err.message || 'Failed to authenticate with GitHub.');
      }
    };

    authenticateWithGithub();
  }, [searchParams, dispatch, navigate, BASE_URL]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
      <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full border border-gray-700 text-center space-y-4">
        {error ? (
          <>
            <AlertCircle size={48} className="mx-auto text-red-400" />
            <h2 className="text-xl font-bold text-red-400">Authentication Error</h2>
            <p className="text-sm text-gray-300">{error}</p>
            <button
              onClick={() => navigate('/login')}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Back to Login
            </button>
          </>
        ) : (
          <>
            <Loader2 size={48} className="mx-auto animate-spin text-blue-400" />
            <h2 className="text-xl font-bold text-white">Authenticating with GitHub...</h2>
            <p className="text-sm text-gray-400">Exchanging credentials and setting up your workspace.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default GithubCallback;
