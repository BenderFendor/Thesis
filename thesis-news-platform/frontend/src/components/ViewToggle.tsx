'use client';

import { Grid3X3, List } from 'lucide-react';

interface ViewToggleProps {
  view: 'grid' | 'tiktok';
  onViewChange: (view: 'grid' | 'tiktok') => void;
}

export default function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <div className="flex items-center bg-gray-900/50 border border-gray-700/50 rounded-lg p-1 backdrop-blur-sm">
      <button
        onClick={() => onViewChange('grid')}
        className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
          view === 'grid'
            ? 'bg-green-500 text-white shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
        }`}
        title="Grid View"
      >
        <Grid3X3 size={16} />
        <span className="hidden sm:inline">Grid</span>
      </button>
      
      <button
        onClick={() => onViewChange('tiktok')}
        className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
          view === 'tiktok'
            ? 'bg-green-500 text-white shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
        }`}
        title="TikTok View"
      >
        <List size={16} />
        <span className="hidden sm:inline">Scroll</span>
      </button>
    </div>
  );
}
