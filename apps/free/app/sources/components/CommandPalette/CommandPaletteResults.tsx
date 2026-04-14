import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform } from 'react-native';
import { CommandPaletteItem } from './CommandPaletteItem';
import { Command, CommandCategory } from './types';
import { Typography } from '@/constants/Typography';

interface CommandPaletteResultsProps {
  categories: CommandCategory[];
  selectedIndex: number;
  onSelectCommand: (command: Command) => void;
  onSelectionChange: (index: number) => void;
}

const CommandPaletteResultRow = React.memo(function CommandPaletteResultRow({
  command,
  commandIndex,
  isSelected,
  onSelectCommand,
  onSelectionChange,
  itemRefs,
}: {
  command: Command;
  commandIndex: number;
  isSelected: boolean;
  onSelectCommand: (command: Command) => void;
  onSelectionChange: (index: number) => void;
  itemRefs: React.MutableRefObject<{ [key: number]: View | null }>;
}) {
  return (
    <View
      ref={ref => {
        itemRefs.current[commandIndex] = ref;
      }}
    >
      <CommandPaletteItem
        command={command}
        isSelected={isSelected}
        onPress={() => onSelectCommand(command)}
        onHover={() => onSelectionChange(commandIndex)}
      />
    </View>
  );
});

function CommandPaletteResultsInner({
  categories,
  selectedIndex,
  onSelectCommand,
  onSelectionChange,
}: CommandPaletteResultsProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const itemRefs = useRef<{ [key: number]: View | null }>({});

  // Flatten commands for index tracking
  const allCommands = React.useMemo(() => {
    return categories.flatMap(cat => cat.commands);
  }, [categories]);

  // Scroll to selected item when index changes
  useEffect(() => {
    const selectedItem = itemRefs.current[selectedIndex];
    if (!selectedItem || !scrollViewRef.current) return;

    // Web: use DOM scrollIntoView
    if (typeof (selectedItem as any).scrollIntoView === 'function') {
      (selectedItem as any).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    // Native: measure item position and scroll to it
    (selectedItem as any).measureLayout?.(
      (scrollViewRef.current as any).getInnerViewNode?.() ?? scrollViewRef.current,
      (_x: number, y: number) => {
        scrollViewRef.current?.scrollTo({ y, animated: true });
      },
      () => {} // measurement failure — ignore
    );
  }, [selectedIndex]);

  if (categories.length === 0 || allCommands.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, Typography.default()]}>No commands found</Text>
      </View>
    );
  }

  let currentIndex = 0;

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {categories.map(category => {
        if (category.commands.length === 0) return null;

        const categoryStartIndex = currentIndex;
        const categoryCommands = category.commands.map((command, idx) => {
          const commandIndex = categoryStartIndex + idx;
          const isSelected = commandIndex === selectedIndex;
          currentIndex++;

          return (
            <CommandPaletteResultRow
              key={command.id}
              command={command}
              commandIndex={commandIndex}
              isSelected={isSelected}
              onSelectCommand={onSelectCommand}
              onSelectionChange={onSelectionChange}
              itemRefs={itemRefs}
            />
          );
        });

        return (
          <View key={category.id}>
            <Text style={[styles.categoryTitle, Typography.default('semiBold')]}>
              {category.title}
            </Text>
            {categoryCommands}
          </View>
        );
      })}
    </ScrollView>
  );
}

export const CommandPaletteResults = React.memo(CommandPaletteResultsInner);

const styles = StyleSheet.create({
  container: {
    // Use viewport-based height for better proportions
    ...(Platform.OS === 'web'
      ? ({
          maxHeight: '40vh', // 40% of viewport height for results
        } as any)
      : {
          maxHeight: 420, // Fallback for native
        }),
    paddingVertical: 8,
  },
  emptyContainer: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#999',
    letterSpacing: -0.2,
  },
  categoryTitle: {
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 8,
    fontSize: 12,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '600',
  },
});
