'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { API_ENDPOINTS, apiCall } from '@/config/api';

interface BackendStatusProps {
  onBackendReady: () => void;
  onRetry: () => void;
}

export default function BackendStatus({ onBackendReady, onRetry }: BackendStatusProps) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [retryCount, setRetryCount] = useState(0);

  const checkBackendStatus = async () => {
    try {
      setStatus('checking');
      await apiCall(API_ENDPOINTS.health);
      setStatus('ready');
      setTimeout(() => {
        onBackendReady();
      }, 500);
    } catch (error) {
      console.error('Backend health check failed:', error);
      setStatus('error');
    }
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    onRetry();
    checkBackendStatus();
  };

  useEffect(() => {
    checkBackendStatus();
  }, []);

  if (status === 'ready') {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Backend Ready!</h3>
          <p className="text-gray-400">Loading news articles...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Backend Connection Failed</h3>
          <p className="text-gray-400 mb-6">
            Unable to connect to the news API. Please make sure the backend server is running.
          </p>
          <div className="space-y-4">
            <button
              onClick={handleRetry}
              className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry Connection {retryCount > 0 && `(${retryCount})`}
            </button>
            <div className="text-sm text-gray-500">
              <p>To start the backend:</p>
              <code className="block mt-2 p-2 bg-gray-800 rounded text-gray-300">
                docker compose up --build
              </code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
        <h3 className="text-xl font-semibold text-white mb-2">Connecting to Backend</h3>
        <p className="text-gray-400">
          Checking if the news API is ready...
        </p>
        <div className="mt-4 flex justify-center">
          <div className="flex space-x-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
