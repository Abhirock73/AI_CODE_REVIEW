/**
 * A centralized wrapper for the native fetch API.
 * This ensures that credentials (like our httpOnly cookie) 
 * are automatically sent with every request to the backend.
 */
export async function apiFetch(url, options = {}) {
  const fetchOptions = {
    ...options,
    credentials: 'include', // Ensures cookies are sent with requests
  };

  return fetch(url, fetchOptions);
}
