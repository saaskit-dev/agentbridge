import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { FloatingOverlay } from './FloatingOverlay';

interface AgentInputAutocompleteProps {
  suggestions: React.ReactElement[];
  selectedIndex?: number;
  onSelect: (index: number) => void;
  itemHeight: number;
}

const AgentInputAutocompleteRow = React.memo(function AgentInputAutocompleteRow({
  suggestion,
  index,
  selected,
  onSelect,
  itemHeight,
}: {
  suggestion: React.ReactElement;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
  itemHeight: number;
}) {
  const { theme } = useUnistyles();

  return (
    <Pressable
      onPress={() => onSelect(index)}
      style={({ pressed }) => ({
        height: itemHeight,
        backgroundColor: pressed
          ? theme.colors.surfacePressed
          : selected
            ? theme.colors.surfaceSelected
            : 'transparent',
      })}
    >
      {suggestion}
    </Pressable>
  );
});

export const AgentInputAutocomplete = React.memo((props: AgentInputAutocompleteProps) => {
  const { suggestions, selectedIndex = -1, onSelect, itemHeight } = props;

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <FloatingOverlay maxHeight={240} keyboardShouldPersistTaps="handled">
      {suggestions.map((suggestion, index) => (
        <AgentInputAutocompleteRow
          key={index}
          suggestion={suggestion}
          index={index}
          selected={selectedIndex === index}
          onSelect={onSelect}
          itemHeight={itemHeight}
        />
      ))}
    </FloatingOverlay>
  );
});
