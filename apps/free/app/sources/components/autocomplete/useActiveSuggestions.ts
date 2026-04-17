import * as React from 'react';
import { ValueSync } from '@/utils/sync';

interface SuggestionOptions {
  clampSelection?: boolean; // If true, clamp instead of preserving exact position
  autoSelectFirst?: boolean; // If true, automatically select first item when suggestions appear
  wrapAround?: boolean; // If true, wrap around when reaching top/bottom
  debounceMs?: number;
  suspend?: boolean;
}

export function useActiveSuggestions(
  query: string | null,
  handler: (query: string) => Promise<
    {
      key: string;
      text: string;
      component: React.ElementType;
    }[]
  >,
  options: SuggestionOptions = {}
) {
  const {
    clampSelection = true,
    autoSelectFirst = true,
    wrapAround = true,
    debounceMs = 350,
    suspend = false,
  } = options;
  const handlerRef = React.useRef(handler);
  const debounceTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeQueryRef = React.useRef<string | null>(null);

  // State for suggestions
  const [state, setState] = React.useState<{
    suggestions: { key: string; text: string; component: React.ElementType }[];
    selected: number;
  }>({
    suggestions: [],
    selected: -1,
  });

  const moveUp = React.useCallback(() => {
    setState(prev => {
      if (prev.suggestions.length === 0) return prev;

      if (prev.selected <= 0) {
        // At top or nothing selected
        if (wrapAround) {
          return { ...prev, selected: prev.suggestions.length - 1 };
        } else {
          return { ...prev, selected: 0 };
        }
      }
      // Move up
      return { ...prev, selected: prev.selected - 1 };
    });
  }, [wrapAround]);

  const moveDown = React.useCallback(() => {
    setState(prev => {
      if (prev.suggestions.length === 0) return prev;

      if (prev.selected >= prev.suggestions.length - 1) {
        // At bottom
        if (wrapAround) {
          return { ...prev, selected: 0 };
        } else {
          return { ...prev, selected: prev.suggestions.length - 1 };
        }
      }
      // If nothing selected, select first
      if (prev.selected < 0) {
        return { ...prev, selected: 0 };
      }
      // Move down
      return { ...prev, selected: prev.selected + 1 };
    });
  }, [wrapAround]);

  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  // Sync query to suggestions
  const sync = React.useMemo(() => {
    return new ValueSync<string | null>(async query => {
      if (!query) {
        return;
      }
      const suggestions = await handlerRef.current(query);
      if (activeQueryRef.current !== query) {
        return;
      }
      setState(prev => {
        if (clampSelection) {
          // Simply clamp the selection to valid range
          let newSelected = prev.selected;

          if (suggestions.length === 0) {
            newSelected = -1;
          } else if (autoSelectFirst && prev.suggestions.length === 0) {
            // First time showing suggestions, auto-select first
            newSelected = 0;
          } else if (prev.selected >= suggestions.length) {
            // Selection is out of bounds, clamp to last item
            newSelected = suggestions.length - 1;
          } else if (prev.selected < 0 && suggestions.length > 0 && autoSelectFirst) {
            // No selection but we have suggestions
            newSelected = 0;
          }

          return { suggestions, selected: newSelected };
        } else {
          // Try to preserve selection by key (old behavior)
          if (prev.selected >= 0 && prev.selected < prev.suggestions.length) {
            const previousKey = prev.suggestions[prev.selected].key;
            const newIndex = suggestions.findIndex(s => s.key === previousKey);
            if (newIndex !== -1) {
              // Found the same key, keep it selected
              return { suggestions, selected: newIndex };
            }
          }

          // Key not found or no previous selection, clamp the selection
          const clampedSelection = Math.min(prev.selected, suggestions.length - 1);
          return {
            suggestions,
            selected:
              clampedSelection < 0 && suggestions.length > 0 && autoSelectFirst
                ? 0
                : clampedSelection,
          };
        }
      });
    });
  }, [clampSelection, autoSelectFirst]);

  React.useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (suspend || !query) {
      activeQueryRef.current = null;
      setState(prev =>
        prev.suggestions.length === 0 && prev.selected === -1
          ? prev
          : { suggestions: [], selected: -1 }
      );
      return;
    }

    activeQueryRef.current = query;
    setState(prev =>
      prev.suggestions.length === 0 && prev.selected === -1
        ? prev
        : { suggestions: [], selected: -1 }
    );
    debounceTimeoutRef.current = setTimeout(() => {
      sync.setValue(query);
    }, debounceMs);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, [debounceMs, query, suspend, sync]);

  React.useEffect(
    () => () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      sync.stop();
    },
    [sync]
  );

  // If no query return empty suggestions
  if (!query || suspend) {
    return [[], -1, moveUp, moveDown] as const;
  }

  // Return state suggestions
  return [state.suggestions, state.selected, moveUp, moveDown] as const;
}
