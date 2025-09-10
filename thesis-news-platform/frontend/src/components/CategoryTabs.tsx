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
    <div className="border-b border-gray-200 dark:border-gray-700">
      <nav className="flex space-x-8 overflow-x-auto" aria-label="Categories">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => onCategoryChange(category)}
            className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              selectedCategory === category
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {categoryDisplayNames[category] || category.charAt(0).toUpperCase() + category.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}
