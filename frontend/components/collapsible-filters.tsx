"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CollapsibleFiltersProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectedCountry: string;
  onCountryChange: (country: string) => void;
  selectedCredibility: string;
  onCredibilityChange: (credibility: string) => void;
}

const countries = [
  "All",
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Canada",
  "Australia",
  "India",
  "China",
  "Japan",
  "Russia",
  "Spain",
];

const credibilityLevels = ["All", "High", "Medium", "Low"];

export function CollapsibleFilters({
  searchTerm,
  onSearchChange,
  selectedCountry,
  onCountryChange,
  selectedCredibility,
  onCredibilityChange,
}: CollapsibleFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mb-4">
      {/* Compact default view */}
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search articles..."
          className="max-w-md font-sans"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="font-sans"
        >
          <Filter className="w-4 h-4 mr-2" />
          Filters
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 ml-2" />
          ) : (
            <ChevronDown className="w-4 h-4 ml-2" />
          )}
        </Button>
      </div>

      {/* Expandable filters */}
      <div
        className={cn(
          "mt-3 flex gap-2 flex-wrap transition-all overflow-hidden",
          isExpanded
            ? "max-h-40 opacity-100 visible"
            : "max-h-0 opacity-0 invisible"
        )}
      >
        {/* Country filter */}
        <Select value={selectedCountry} onValueChange={onCountryChange}>
          <SelectTrigger className="w-40 font-sans">
            <SelectValue placeholder="Select country..." />
          </SelectTrigger>
          <SelectContent>
            {countries.map((country) => (
              <SelectItem key={country} value={country}>
                {country}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Credibility filter */}
        <Select value={selectedCredibility} onValueChange={onCredibilityChange}>
          <SelectTrigger className="w-40 font-sans">
            <SelectValue placeholder="Select credibility..." />
          </SelectTrigger>
          <SelectContent>
            {credibilityLevels.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
