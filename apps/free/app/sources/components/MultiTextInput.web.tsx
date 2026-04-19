import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import TextareaAutosize from 'react-textarea-autosize';
import { Typography } from '@/constants/Typography';

export type SupportedKey =
  | 'Enter'
  | 'Escape'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Tab';

export interface KeyPressEvent {
  key: SupportedKey;
  shiftKey: boolean;
}

export type OnKeyPressCallback = (event: KeyPressEvent) => boolean;

export interface TextInputSelection {
  start: number;
  end: number;
}

export interface MultiTextInputHandle {
  setTextAndSelection: (text: string, selection: TextInputSelection) => void;
  focus: () => void;
  blur: () => void;
}

interface MultiTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxHeight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  onKeyPress?: OnKeyPressCallback;
  onSelectionChange?: (selection: TextInputSelection) => void;
  onCompositionStateChange?: (isComposing: boolean) => void;
}

export const MultiTextInput = React.forwardRef<MultiTextInputHandle, MultiTextInputProps>(
  (props, ref) => {
    const {
      value,
      onChangeText,
      placeholder,
      maxHeight = 120,
      onKeyPress,
      onSelectionChange,
      onCompositionStateChange,
    } = props;

    const { theme } = useUnistyles();
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const isComposingRef = React.useRef(false);
    const selectionRef = React.useRef<TextInputSelection>({ start: 0, end: 0 });

    // Convert maxHeight to approximate maxRows (assuming ~24px line height)
    const maxRows = Math.floor(maxHeight / 24);

    React.useEffect(() => {
      const max = value.length;
      const { start, end } = selectionRef.current;
      if (start > max || end > max) {
        selectionRef.current = { start: max, end: max };
      }
    }, [value]);

    const emitSelectionChange = React.useCallback(
      (selection: TextInputSelection) => {
        if (
          selection.start === selectionRef.current.start &&
          selection.end === selectionRef.current.end
        ) {
          return;
        }
        selectionRef.current = selection;
        onSelectionChange?.(selection);
      },
      [onSelectionChange]
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!onKeyPress) return;

        const isComposing =
          isComposingRef.current ||
          e.nativeEvent.isComposing ||
          (e.nativeEvent as any).isComposing ||
          e.keyCode === 229;
        if (isComposing) {
          return;
        }

        const key = e.key;

        // Map browser key names to our normalized format
        let normalizedKey: SupportedKey | null = null;

        switch (key) {
          case 'Enter':
            normalizedKey = 'Enter';
            break;
          case 'Escape':
            normalizedKey = 'Escape';
            break;
          case 'ArrowUp':
            normalizedKey = 'ArrowUp';
            break;
          case 'ArrowDown':
            normalizedKey = 'ArrowDown';
            break;
          case 'ArrowLeft':
            normalizedKey = 'ArrowLeft';
            break;
          case 'ArrowRight':
            normalizedKey = 'ArrowRight';
            break;
          case 'Tab':
            normalizedKey = 'Tab';
            break;
        }

        if (normalizedKey) {
          const keyEvent: KeyPressEvent = {
            key: normalizedKey,
            shiftKey: e.shiftKey,
          };

          const handled = onKeyPress(keyEvent);
          if (handled) {
            e.preventDefault();
          }
        }
      },
      [onKeyPress]
    );

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        const selection = {
          start: e.target.selectionStart,
          end: e.target.selectionEnd,
        };

        onChangeText(text);
        emitSelectionChange(selection);
      },
      [emitSelectionChange, onChangeText]
    );

    const handleSelect = React.useCallback(
      (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement;
        const selection = {
          start: target.selectionStart,
          end: target.selectionEnd,
        };
        emitSelectionChange(selection);
      },
      [emitSelectionChange]
    );

    const handleCompositionStart = React.useCallback(() => {
      isComposingRef.current = true;
      onCompositionStateChange?.(true);
    }, [onCompositionStateChange]);

    const handleCompositionEnd = React.useCallback(() => {
      isComposingRef.current = false;
      onCompositionStateChange?.(false);
    }, [onCompositionStateChange]);

    // Imperative handle for direct control
    React.useImperativeHandle(
      ref,
      () => ({
        setTextAndSelection: (text: string, selection: TextInputSelection) => {
          if (!textareaRef.current || isComposingRef.current) {
            return;
          }

          // Keep this path controlled by React state updates. Imperatively mutating the
          // textarea value and dispatching synthetic input events can conflict with IME
          // composition state on macOS WebKit.
          onChangeText(text);
          emitSelectionChange(selection);

          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            try {
              el.setSelectionRange(selection.start, selection.end);
            } catch {
              // Ignore detached/unfocusable textarea edge cases.
            }
          });
        },
        focus: () => {
          textareaRef.current?.focus();
        },
        blur: () => {
          textareaRef.current?.blur();
        },
      }),
      [emitSelectionChange, onChangeText]
    );

    return (
      <View style={{ width: '100%' }}>
        <TextareaAutosize
          ref={textareaRef}
          style={{
            width: '100%',
            padding: '0',
            fontSize: '16px',
            color: theme.colors.input.text,
            border: 'none',
            outline: 'none',
            resize: 'none' as const,
            backgroundColor: 'transparent',
            fontFamily: Typography.default().fontFamily,
            lineHeight: '1.4',
            scrollbarWidth: 'none',
            paddingTop: props.paddingTop,
            paddingBottom: props.paddingBottom,
            paddingLeft: props.paddingLeft,
            paddingRight: props.paddingRight,
          }}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          maxRows={maxRows}
          autoCapitalize="sentences"
          autoCorrect="on"
          autoComplete="off"
        />
      </View>
    );
  }
);

MultiTextInput.displayName = 'MultiTextInput';
