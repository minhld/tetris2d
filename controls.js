import React, { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

export function useSwipe(enabled, cellSize, act) {
  const gesture = useRef(null);

  function track(event, finish = false) {
    const touch = gesture.current;
    if (!enabled || !touch) return;
    const { pageX, pageY, touches } = event.nativeEvent;
    if (touches?.length > 1) touch.axis = 'cancelled';
    const dx = pageX - touch.x;
    const dy = pageY - touch.y;
    const threshold = 10;
    if (!touch.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
      touch.axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : dy > 0 ? 'down' : 'cancelled';
    }
    if (touch.axis === 'horizontal') {
      const stride = Math.max(threshold, cellSize * 0.8);
      const delta = pageX - touch.anchor;
      const distance = touch.moved ? stride : threshold;
      if (Math.abs(delta) >= distance) {
        const direction = Math.sign(delta);
        const steps = 1 + Math.floor((Math.abs(delta) - distance) / stride);
        touch.anchor += direction * (distance + (steps - 1) * stride);
        touch.moved = true;
        for (let i = 0; i < steps; i++) {
          if (!act(direction < 0 ? 'left' : 'right', touch.pieceNumber)) break;
        }
      }
    }
    if (!finish) return;
    gesture.current = null;
    if (touch.axis === 'down') act('drop', touch.pieceNumber);
    if (!touch.axis && Date.now() - touch.started <= 275) act('rotate', touch.pieceNumber);
  }

  return (pieceNumber) => ({
    onStartShouldSetResponder: () => enabled,
    onResponderGrant: ({ nativeEvent }) => {
      gesture.current = { x: nativeEvent.pageX, y: nativeEvent.pageY, started: Date.now(),
        anchor: nativeEvent.pageX, moved: false, axis: null, pieceNumber };
    },
    onResponderMove: (event) => track(event),
    onResponderRelease: (event) => track(event, true),
    onResponderTerminate: () => { gesture.current = null; },
  });
}

function PadKey({ action, symbol, label, theme, act }) {
  const timers = useRef({});
  function stop() {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
  }
  useEffect(() => stop, []);

  function start() {
    stop();
    if (!act(action)) return;
    timers.current.delay = setTimeout(() => {
      if (!act(action)) return;
      timers.current.repeat = setInterval(() => { if (!act(action)) stop(); }, action === 'down' ? 48 : 60);
    }, 200);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={action === 'rotate' ? undefined : start}
      onPressOut={stop}
      onPress={action === 'rotate' ? () => act(action) : undefined}
      accessibilityActions={action === 'rotate' ? undefined : [{ name: 'activate' }]}
      onAccessibilityAction={action === 'rotate' ? undefined : () => act(action)}
      style={({ pressed }) => ({
        width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
        borderRadius: action === 'rotate' ? 24 : 15, borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: pressed ? theme.accent : action === 'rotate' ? theme.selected : theme.pad,
      })}
    >
      {({ pressed }) => <Text style={{ color: pressed ? theme.ink : theme.text, fontSize: 23 }}>{symbol}</Text>}
    </Pressable>
  );
}

export function DPad({ side, theme, act }) {
  return (
    <View pointerEvents="box-none" style={{ alignSelf: side === 'left' ? 'flex-start' : 'flex-end', gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        <PadKey action="left" symbol="←" label="Move left" theme={theme} act={act} />
        <PadKey action="rotate" symbol="↻" label="Rotate clockwise" theme={theme} act={act} />
        <PadKey action="right" symbol="→" label="Move right" theme={theme} act={act} />
      </View>
      <View style={{ alignSelf: 'center' }}>
        <PadKey action="down" symbol="↓" label="Move down" theme={theme} act={act} />
      </View>
    </View>
  );
}
