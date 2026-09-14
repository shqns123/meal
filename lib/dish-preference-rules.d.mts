export const CATEGORIES: string[];
export const SCOPES: string[];
export const USAGES: string[];
export const FAMILIARITIES: string[];
export function dishName(value: unknown): string;
export function dishCategory(value: string): string;
export type PreferenceInput = {name: string; category: string; scope: string; usage?: string; familiarity?: string; note?: string};
export function validatePreference(input: unknown): PreferenceInput;
export function effectiveUsage(preferences: {scope: string; usage: string}[], roles?: string[]): string;
