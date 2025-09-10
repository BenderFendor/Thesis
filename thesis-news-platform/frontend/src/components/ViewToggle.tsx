'use client';

import { Grid3X3, Play } from 'lucide-react';

interface ViewToggleProps {
  view: 'grid' | 'tiktok';
  onViewChange: (view: 'grid' | 'tiktok') => void;
}

export default function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-gray-800/80 backdrop-blur-sm rounded-lg p-1 border border-gray-700/50 shadow-lg">
      <button
        onClick={() => onViewChange('grid')}
        className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
          view === 'grid'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 scale-105'
            : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
        }`}
      >
        <Grid3X3 className="w-4 h-4 mr-2" />
        Grid
      </button>
      <button
        onClick={() => onViewChange('tiktok')}
        className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
          view === 'tiktok'
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25 scale-105'
            : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
        }`}
      >
        <Play className="w-4 h-4 mr-2" />
        Scroll
      </button>
    </div>
  );
}
