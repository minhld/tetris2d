import React, { useEffect, useRef, useState } from 'react';
import {
  AppState, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { COLS, ROWS, DURATIONS, SHAPES, cells, landing, level, newGame, play, saveScore, tick } from './game.mjs';
import { DPad, useSwipe } from './controls';

const STORAGE_KEY = 'stack-shift-v1';
const MODES = { simple: 'Simple', advanced: 'Advanced', timed: 'Timed' };
const DEFAULTS = { input: 'swipe', side: 'right', appearance: 'dark', palette: 'color', ghost: true };
const COLORS = ['#63CBEA', '#F7D879', '#F09A78', '#A2DA8D', '#B5A3FD', '#70A3FF', '#EC83AE', '#65D8BA'];
const THEMES = {
  dark: {
    bg: '#10131D', surface: '#191E2C', board: '#131724', cell: '#1B2130', border: '#30394D',
    text: '#F3F5FC', muted: '#ADB7CC', accent: '#A6E9BC', ink: '#14251D', selected: '#294238',
    pad: '#2D384DAA', veil: '#10131DDD', mono: '#589DE9',
  },
  light: {
    bg: '#EEF2F7', surface: '#FFFFFF', board: '#D8E1EC', cell: '#E8EDF6', border: '#BCC9DA',
    text: '#182538', muted: '#4B5C74', accent: '#A6E9BC', ink: '#14251D', selected: '#D7EDDF',
    pad: '#C2D0E2AA', veil: '#EEF2F7ED', mono: '#2767B6',
  },
};

function currentTheme(settings) {
  const theme = THEMES[settings.appearance];
  if (settings.palette === 'color') return theme;
  return { ...theme, accent: '#A4CFFF', ink: '#122644',
    selected: settings.appearance === 'dark' ? '#243854' : '#D8E7FA' };
}

const pieceColor = (kind, settings, theme) => settings.palette === 'blue' ? theme.mono : COLORS[kind];
const timeLabel = (ms) => {
  const seconds = Math.ceil(ms / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};

function Label({ children, theme }) {
  return <Text style={[styles.label, { color: theme.muted }]}>{children}</Text>;
}

function Button({ title, onPress, theme, primary, selected, accessibilityLabel }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress} style={({ pressed }) => [
        styles.button, { borderColor: selected ? theme.accent : theme.border,
          backgroundColor: primary ? theme.accent : selected ? theme.selected : theme.surface,
          opacity: pressed ? 0.75 : 1 },
      ]}>
      <Text style={[styles.buttonText, { color: primary ? theme.ink : theme.text }]}>{title}</Text>
    </Pressable>
  );
}

function Options({ label, options, value, onChange, theme }) {
  return (
    <View style={styles.option}>
      <Label theme={theme}>{label}</Label>
      <View style={styles.wrap}>
        {options.map(([key, title]) => (
          <Button key={String(key)} title={title} theme={theme} selected={value === key} onPress={() => onChange(key)} />
        ))}
      </View>
    </View>
  );
}

function Stat({ label, value, theme }) {
  return (
    <View style={styles.stat}>
      <Label theme={theme}>{label}</Label>
      <Text numberOfLines={1} style={[styles.statValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function Next({ game, settings, theme }) {
  const shape = SHAPES[game.next];
  return (
    <View style={styles.stat} accessible accessibilityLabel="Next piece">
      <Label theme={theme}>Next</Label>
      <View style={styles.preview}>
        {shape.map((row, index) => (
          <View key={index} style={styles.row}>
            {row.map((occupied, column) => (
              <View key={column} style={{ width: 8, height: 8, margin: 0.5, borderRadius: 2,
                backgroundColor: occupied ? pieceColor(game.next, settings, theme) : 'transparent' }} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Board({ game, size, theme, settings, responder, overlay }) {
  const active = new Set();
  const ghost = new Set();
  if (!game.end) {
    for (const [x, y] of cells(game.piece)) active.add(y * COLS + x);
    if (settings.ghost) {
      for (const [x, y] of cells(landing(game))) ghost.add(y * COLS + x);
    }
  }

  return (
    <View style={[styles.board, { borderColor: theme.border, backgroundColor: theme.board }]} {...responder}>
      <View pointerEvents="none">
        {game.board.map((row, y) => (
          <View key={y} style={styles.row}>
            {row.map((kind, x) => {
              const index = y * COLS + x;
              const filled = active.has(index) ? game.piece.kind : kind;
              const outline = filled === null && ghost.has(index);
              return <View key={x} style={{ width: size, height: size, padding: 0.65 }}>
                <View style={{ flex: 1, borderRadius: 2, backgroundColor: filled === null
                  ? theme.cell : pieceColor(filled, settings, theme),
                borderWidth: outline ? 1 : 0,
                borderColor: outline ? pieceColor(game.piece.kind, settings, theme) : 'transparent',
                opacity: outline ? 0.65 : 1 }} />
              </View>;
            })}
          </View>
        ))}
      </View>
      {overlay}
    </View>
  );
}

function GameScreen() {
  const [data, setData] = useState(null);
  const model = useRef(null);
  const [screen, setScreen] = useState(null);
  const [paused, setPaused] = useState(true);
  const running = useRef(false);
  const lastTick = useRef(0);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [storageError, setStorageError] = useState(false);
  const pending = useRef(null);
  const writing = useRef(false);
  const [mode, setMode] = useState('simple');
  const [minutes, setMinutes] = useState(5);
  const [scoreMode, setScoreMode] = useState('simple');

  function update(next) {
    model.current = next;
    setData(next);
  }

  async function persist() {
    if (!model.current) return;
    pending.current = model.current;
    if (writing.current) return;
    writing.current = true;
    try {
      while (pending.current) {
        const snapshot = pending.current;
        pending.current = null;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      }
      setStorageError(false);
    } catch {
      setStorageError(true);
    } finally {
      writing.current = false;
    }
  }

  function accept(game) {
    const previous = model.current;
    if (game === previous.game) return;
    const ended = game.end && !previous.game.end;
    update({ ...previous, game, records: ended ? saveScore(previous.records, game) : previous.records });
    if (ended) {
      running.current = false;
      persist();
    } else if (game.pieceNumber !== previous.game.pieceNumber) {
      persist();
    }
  }

  function advance() {
    if (!running.current) return;
    const now = Date.now();
    accept(tick(model.current.game, Math.max(0, now - lastTick.current)));
    lastTick.current = now;
  }

  function pause() {
    advance();
    running.current = false;
    setPaused(true);
    persist();
  }

  function resume() {
    if (model.current.game.end || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
    lastTick.current = Date.now();
    running.current = true;
    setPaused(false);
  }

  useEffect(() => {
    let live = true;
    async function load() {
      let saved;
      try {
        saved = JSON.parse(await AsyncStorage.getItem(STORAGE_KEY));
      } catch {
        if (live) setStorageError(true);
      }
      if (!live) return;
      update({ game: saved?.game ?? newGame(), records: saved?.records ?? {},
        settings: { ...DEFAULTS, ...saved?.settings } });
      if (!saved?.game) resume();
    }
    load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && model.current) pause();
    });
    const loop = setInterval(advance, 50);
    const checkpoint = setInterval(() => { if (running.current) persist(); }, 750);
    return () => {
      live = false;
      subscription.remove();
      clearInterval(loop);
      clearInterval(checkpoint);
    };
  }, []);

  function act(action, pieceNumber) {
    if (!running.current) return false;
    const game = model.current.game;
    if (pieceNumber !== undefined && pieceNumber !== game.pieceNumber) return false;
    const next = play(game, action);
    accept(next);
    return next.pieceNumber === game.pieceNumber && next !== game;
  }

  function begin(nextMode, duration) {
    pause();
    const previous = model.current;
    const records = previous.game.end ? previous.records : saveScore(previous.records, previous.game);
    update({ ...previous, game: newGame(nextMode, duration), records });
    persist();
    setScreen(null);
    resume();
  }

  function change(key, value) {
    const previous = model.current;
    update({ ...previous, settings: { ...previous.settings, [key]: value } });
    persist();
  }

  function open(name) {
    pause();
    const game = model.current.game;
    if (name === 'modes') {
      setMode(game.mode);
      setMinutes(game.minutes);
    }
    if (name === 'scores') setScoreMode(game.mode);
    setScreen(name);
  }

  const settings = data?.settings ?? DEFAULTS;
  const theme = currentTheme(settings);
  const size = Math.max(1, Math.min(29, (space.width - 2) / COLS, (space.height - 2) / ROWS));
  const game = data?.game;
  const responder = useSwipe(Boolean(game && !game.end && !paused && !screen && settings.input === 'swipe'), size, act);
  const modalTitle = { settings: 'Settings', modes: 'New game', scores: 'High scores', reset: 'Reset game?' }[screen];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={settings.appearance === 'dark' ? 'light-content' : 'dark-content'} />
      {!game ? <Text style={{ color: theme.text }}>Loading…</Text> : (
        <View style={styles.page}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.text }]}>Stack Shift</Text>
              <Text style={[styles.mode, { color: settings.appearance === 'dark' ? theme.accent : theme.muted }]}>
                {MODES[game.mode]}{game.mode === 'timed' ? ' · ' + game.minutes + ' min' : ''}
              </Text>
            </View>
            {!game.end && <Button title={paused ? 'Resume' : 'Pause'} theme={theme}
              onPress={paused ? resume : pause} selected={paused} />}
          </View>

          <View style={[styles.stats, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Stat label="Score" value={game.score} theme={theme} />
            <Stat label="Best" value={Math.max(game.score, data.records[game.mode]?.[0]?.score ?? 0)} theme={theme} />
            {game.mode === 'advanced' && <Stat label="Level" value={level(game)} theme={theme} />}
            {game.mode === 'timed' && <Stat label="Time" value={timeLabel(game.remaining)} theme={theme} />}
            <Next game={game} settings={settings} theme={theme} />
          </View>

          <View style={styles.playfield} onLayout={({ nativeEvent }) => setSpace(nativeEvent.layout)}>
            {space.height > 2 && space.width > 2 && <Board game={game} size={size} theme={theme}
              settings={settings} responder={responder(game.pieceNumber)}
              overlay={(paused || game.end) && (
                <View style={[styles.overlay, { backgroundColor: theme.veil }]}>
                  <Text style={[styles.overlayTitle, { color: theme.text }]}>{game.end ?? 'Paused'}</Text>
                  {game.end && <Text style={{ color: theme.muted }}>Score {game.score}</Text>}
                  <Button title={game.end ? 'Play again' : 'Resume game'} theme={theme} primary
                    onPress={game.end ? () => begin(game.mode, game.minutes) : resume} />
                </View>
              )} />}
          </View>

          {settings.input === 'buttons' ? (
            <View style={styles.padArea} pointerEvents="box-none">
              {!paused && !game.end && !screen && <DPad side={settings.side} theme={theme} act={act} />}
            </View>
          ) : <Text style={[styles.hint, { color: theme.muted }]}>Tap to rotate · Swipe ↔ to move · Swipe ↓ to drop</Text>}

          <View style={styles.footer}>
            <Button title="Modes" theme={theme} onPress={() => open('modes')} />
            <Button title="Scores" theme={theme} onPress={() => open('scores')} />
            <Button title="Settings" theme={theme} onPress={() => open('settings')} />
            <Button title="Reset" theme={theme} onPress={() => open('reset')} />
          </View>
          {storageError && <Text accessibilityRole="alert" style={{ color: theme.text }}>Game storage is unavailable.</Text>}
        </View>
      )}

      <Modal visible={Boolean(screen)} animationType="slide" onRequestClose={() => setScreen(null)}>
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
          <View style={styles.page}>
            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.text }]}>{modalTitle}</Text>
              <Button title="Done" theme={theme} onPress={() => setScreen(null)} />
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              {screen === 'settings' && <>
                <Options label="Controls" options={[['swipe', 'Swipe & tap'], ['buttons', 'Buttons']]}
                  value={settings.input} onChange={(value) => change('input', value)} theme={theme} />
                {settings.input === 'buttons' && <Options label="Button position" options={[['left', 'Left'], ['right', 'Right']]}
                  value={settings.side} onChange={(value) => change('side', value)} theme={theme} />}
                <Options label="Appearance" options={[['dark', 'Dark'], ['light', 'Light']]}
                  value={settings.appearance} onChange={(value) => change('appearance', value)} theme={theme} />
                <Options label="Piece colors" options={[['color', 'Multicolor'], ['blue', 'Blue monochrome']]}
                  value={settings.palette} onChange={(value) => change('palette', value)} theme={theme} />
                <Options label="Landing preview" options={[[true, 'On'], [false, 'Off']]}
                  value={settings.ghost} onChange={(value) => change('ghost', value)} theme={theme} />
              </>}
              {screen === 'modes' && <>
                <Options label="Mode" options={Object.entries(MODES)} value={mode} onChange={setMode} theme={theme} />
                <Text style={{ color: theme.muted }}>{{
                  simple: 'Clear rows at a steady speed until the board fills.',
                  advanced: 'Pieces fall faster every 100 points.',
                  timed: 'Clear as many rows as you can before time runs out.',
                }[mode]}</Text>
                {mode === 'timed' && <Options label="Duration" options={DURATIONS.map((value) => [value, value + ' min'])}
                  value={minutes} onChange={setMinutes} theme={theme} />}
                <Button title="Start new game" theme={theme} primary onPress={() => begin(mode, minutes)} />
              </>}
              {screen === 'scores' && <>
                <Options label="Leaderboard" options={Object.entries(MODES)} value={scoreMode} onChange={setScoreMode} theme={theme} />
                {data.records[scoreMode]?.length ? data.records[scoreMode].map((entry, index) => (
                  <View key={index} style={[styles.record, { backgroundColor: theme.surface }]}>
                    <Text style={{ color: theme.muted }}>#{index + 1}{scoreMode === 'timed' ? ' · ' + entry.minutes + ' min' : ''}</Text>
                    <Text style={[styles.statValue, { color: theme.text }]}>{entry.score}</Text>
                  </View>
                )) : <Text style={{ color: theme.muted }}>No scores yet.</Text>}
              </>}
              {screen === 'reset' && <>
                <Text style={{ color: theme.muted }}>Your score will be recorded and a new game will start.</Text>
                <Button title="Save score and reset" theme={theme} primary onPress={() => begin(game.mode, game.minutes)} />
              </>}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><GameScreen /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 540, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 27, fontWeight: '900', letterSpacing: -0.8 },
  mode: { fontSize: 13, fontWeight: '700' },
  stats: { flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, padding: 7 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  statValue: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  preview: { height: 28, justifyContent: 'center', alignItems: 'center' },
  playfield: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  board: { borderWidth: 1, borderRadius: 7, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 10 },
  overlayTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  hint: { fontSize: 12, textAlign: 'center' },
  padArea: { height: 98, justifyContent: 'flex-end' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 3 },
  button: { borderWidth: 1, borderRadius: 11, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  buttonText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  modalBody: { gap: 14, paddingVertical: 14 },
  option: { gap: 8 },
  wrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  record: { padding: 12, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
