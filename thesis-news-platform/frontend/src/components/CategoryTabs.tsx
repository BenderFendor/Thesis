'use client';

import { useState, useEffect } from 'react';
import { API_ENDPOINTS, apiCall } from '@/config/api';

interface CategoryTabsProps {
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
}

export default function CategoryTabs({ selectedCategory, onCategoryChange }: CategoryTabsProps) {
  const [categories, setCategories] = useState<string[]>(['general']);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const data: { categories: string[] } = await apiCall(API_ENDPOINTS.categories);
      setCategories(data.categories || ['general']);
    } catch (error) {
      console.error('Error fetching categories:', error);
      // Fallback to default categories
      setCategories(['general', 'politics', 'technology', 'sports', 'business']);
    }
  };

  const categoryDisplayNames: { [key: string]: string } = {
    general: 'General',
    politics: 'Politics',
    technology: 'Technology',
    sports: 'Sports',
    business: 'Business',
    entertainment: 'Entertainment'
  };

  return (
    <div className="border-b border-gray-800/50">
      <nav className="flex space-x-1 overflow-x-auto" aria-label="Categories">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => onCategoryChange(category)}
            className={`whitespace-nowrap py-3 px-4 rounded-lg font-medium text-sm transition-all ${
              selectedCategory === category
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
          >
            {categoryDisplayNames[category] || category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}
