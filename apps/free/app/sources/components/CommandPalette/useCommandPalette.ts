import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { TextInput } from 'react-native';
import { Command } from './types';
import { buildCommandPaletteData } from './commandPaletteData';

export function useCommandPalette(commands: Command[], onClose: () => void) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<TextInput>(null);

  // Filter commands based on search query
  const paletteData = useMemo(() => {
    return buildCommandPaletteData(commands, searchQuery);
  }, [commands, searchQuery]);
  const filteredCategories = paletteData.categories;

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  const handleSelectCommand = useCallback(
    (command: Command) => {
      command.action();
      onClose();
    },
    [onClose]
  );

  const allCommands = paletteData.allCommands;

  const handleKeyPress = useCallback(
    (key: string) => {
      switch (key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowDown':
          setSelectedIndex(prev => Math.min(prev + 1, allCommands.length - 1));
          break;
        case 'ArrowUp':
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          if (allCommands[selectedIndex]) {
            handleSelectCommand(allCommands[selectedIndex]);
          }
          break;
      }
    },
    [onClose, allCommands, selectedIndex, handleSelectCommand]
  );

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
  }, []);

  return {
    searchQuery,
    selectedIndex,
    filteredCategories,
    inputRef,
    handleSearchChange,
    handleSelectCommand,
    handleKeyPress,
    setSelectedIndex,
  };
}
