'use client';

import React from 'react';

export interface AppDateInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
}

export function AppDateInput({ label, className = '', ...props }: AppDateInputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-semibold text-gray-700">{label}</label>}
      <input
        type="date"
        className={`rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none ${className}`}
        {...props}
      />
    </div>
  );
}
