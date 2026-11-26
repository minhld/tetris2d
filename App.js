import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, BackHandler, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLS, ROWS, DURATIONS, SHAPES, cells, landing, level, newGame, play, saveScore, tick } from './game.mjs';
import { DPad, useEdgeBack, useSwipe } from './controls';

const STORAGE_KEY = 'stack-shift-v1';
const MODES = { simple: 'Simple', advanced: 'Advanced', timed: 'Timed' };
const DEFAULTS = { input: 'swipe', side: 'right', appearance: 'dark', palette: 'color', ghost: true };
const COLORS = ['#63CBEA', '#F7D879', '#F09A78', '#A2DA8D', '#B5A3FD', '#70A3FF', '#EC83AE', '#65D8BA', '#F0B7E3', '#D8E88A'];
const THEMES = {
  dark: {
    bg: '#10131D', surface: '#191E2C', board: '#131724', cell: '#1B2130', border: '#30394D',
    text: '#F3F5FC', muted: '#ADB7CC', accent: '#A6E9BC', ink: '#14251D', selected: '#294238',
    pad: '#2D384DAA', mono: '#589DE9',
  },
  light: {
    bg: '#EEF2F7', surface: '#FFFFFF', board: '#D8E1EC', cell: '#E8EDF6', border: '#BCC9DA',
    text: '#182538', muted: '#4B5C74', accent: '#A6E9BC', ink: '#14251D', selected: '#D7EDDF',
    pad: '#C2D0E2AA', mono: '#2767B6',
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

function ToolbarButton({ title, icon, theme, onPress, featured }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
      style={({ pressed }) => [styles.toolbarButton, {
        backgroundColor: pressed ? theme.selected : 'transparent',
      }]}>
      <View style={[styles.toolbarIcon, featured && { backgroundColor: theme.accent }]}>
        <Text style={[styles.iconText, { color: featured ? theme.ink : theme.text }]}>{icon}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.toolbarLabel, { color: theme.muted }]}>{title}</Text>
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

function Stat({ label, value, theme, compact }) {
  return (
    <View style={[styles.stat, compact && styles.modeStat]}>
      <Label theme={theme}>{label}</Label>
      <Text numberOfLines={1} adjustsFontSizeToFit={compact} minimumFontScale={0.75}
        style={[styles.statValue, compact && styles.modeValue, { color: theme.text }]}>{value}</Text>
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

function Board({ game, size, theme, settings, responder, obscured, clear, onClearEnd }) {
  const [highlighted, setHighlighted] = useState(true);

  useEffect(() => {
    if (!clear) return;
    setHighlighted(true);
    const firstDim = setTimeout(() => setHighlighted(false), 125);
    const secondFlash = setTimeout(() => setHighlighted(true), 250);
    const secondDim = setTimeout(() => setHighlighted(false), 375);
    const end = setTimeout(onClearEnd, 500);
    return () => {
      clearTimeout(firstDim);
      clearTimeout(secondFlash);
      clearTimeout(secondDim);
      clearTimeout(end);
    };
  }, [clear, onClearEnd]);

  const highlightColor = settings.appearance === 'dark' ? '#FFFFFF' : '#253D63';
  const active = new Set();
  const ghost = new Set();
  if (!clear && !game.end) {
    for (const [x, y] of cells(game.piece)) active.add(y * COLS + x);
    if (settings.ghost) {
      for (const [x, y] of cells(landing(game))) ghost.add(y * COLS + x);
    }
  }

  return (
    <View style={[styles.board, { borderColor: theme.border, backgroundColor: theme.board }]} {...responder}>
      <View pointerEvents="none" style={{ opacity: obscured ? 0.09 : 1 }}>
        {(clear?.board ?? game.board).map((row, y) => {
          const clearingRow = clear?.rows.includes(y);
          return (
            <View key={y} style={[styles.row, clearingRow && !highlighted && { opacity: 0.3 }]}>
              {row.map((kind, x) => {
                const index = y * COLS + x;
                const filled = active.has(index) ? game.piece.kind : kind;
                const outline = filled === null && ghost.has(index);
                const color = filled === null ? theme.cell : pieceColor(filled, settings, theme);
                return <View key={x} style={{ width: size, height: size, padding: 0.65 }}>
                  <View style={{ flex: 1, borderRadius: 2,
                    backgroundColor: clearingRow && highlighted ? highlightColor : color,
                    borderWidth: outline ? 1 : 0,
                    borderColor: outline ? pieceColor(game.piece.kind, settings, theme) : 'transparent',
                    opacity: outline ? 0.32 : 1 }} />
                </View>;
              })}
            </View>
          );
        })}
      </View>
      {clear && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Text style={[styles.clearScore, { top: Math.max(24, clear.rows[0] * size - 26),
            backgroundColor: theme.ink, color: theme.accent }]}>+{clear.rows.length}</Text>
        </View>
      )}
    </View>
  );
}

function GameScreen() {
  const insets = useSafeAreaInsets();
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
  const [clear, setClear] = useState(null);
  const clearing = useRef(false);
  const finishClear = useCallback(() => {
    clearing.current = false;
    setClear(null);
  }, []);

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
    if (game.score > previous.game.score) {
      const board = previous.game.board.map((row) => [...row]);
      const piece = landing(previous.game);
      for (const [x, y] of cells(piece)) board[y][x] = piece.kind;
      clearing.current = true;
      setClear({ board, rows: game.clearedRows });
    }
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
    accept(tick(model.current.game, Math.max(0, now - lastTick.current), clearing.current));
    lastTick.current = now;
  }

  function pause() {
    advance();
    running.current = false;
    finishClear();
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
    if (!running.current || clearing.current) return false;
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
  const size = Math.max(1, Math.min((space.width - 2) / COLS, (space.height - 2) / ROWS));
  const game = data?.game;
  const responder = useSwipe(Boolean(game && !game.end && !paused && !screen && settings.input === 'swipe'), size, act);
  const closeScreen = () => setScreen(null);
  const edgeBack = useEdgeBack(closeScreen);
  useEffect(() => {
    if (!screen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen(null);
      return true;
    });
    return () => subscription.remove();
  }, [screen]);
  const obscured = paused || Boolean(game?.end && !clear);
  const modalTitle = { settings: 'Settings', modes: 'New game', scores: 'High scores', reset: 'Reset game?' }[screen];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={settings.appearance === 'dark' ? 'light-content' : 'dark-content'} />
      {!screen && (!game ? <Text style={{ color: theme.text }}>Loading…</Text> : (
        <View style={styles.page}>
          <View style={[styles.stats, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Stat label="Mode" value={MODES[game.mode]} theme={theme} compact />
            <Stat label="Score" value={game.score} theme={theme} />
            <Stat label="Best" value={Math.max(game.score, data.records[game.mode]?.[0]?.score ?? 0)} theme={theme} />
            {game.mode === 'advanced' && <Stat label="Level" value={level(game)} theme={theme} />}
            {game.mode === 'timed' && <Stat label="Time" value={timeLabel(game.remaining)} theme={theme} />}
            <Next game={game} settings={settings} theme={theme} />
          </View>

          <View style={styles.playfield} onLayout={({ nativeEvent }) => setSpace(nativeEvent.layout)}>
            {space.height > 2 && space.width > 2 && <Board game={game} size={size} theme={theme}
              settings={settings} responder={responder(game.pieceNumber)} obscured={obscured}
              clear={clear} onClearEnd={finishClear} />}
            {settings.input === 'buttons' && !obscured && (
              <View style={styles.padArea} pointerEvents="box-none">
                <DPad side={settings.side} theme={theme} act={act} />
              </View>
            )}
          </View>

          <View style={[styles.toolbar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {!game.end && <ToolbarButton title={paused ? 'Resume' : 'Pause'} icon={paused ? '▶' : 'Ⅱ'}
              theme={theme} onPress={paused ? resume : pause} featured />}
            <ToolbarButton title="Modes" icon="◫" theme={theme} onPress={() => open('modes')} />
            <ToolbarButton title="Scores" icon="▥" theme={theme} onPress={() => open('scores')} />
            <ToolbarButton title="Settings" icon="⚙" theme={theme} onPress={() => open('settings')} />
            <ToolbarButton title="Reset" icon="↻" theme={theme} onPress={() => open('reset')} />
          </View>
          {storageError && <Text accessibilityRole="alert" style={{ color: theme.text }}>Game storage is unavailable.</Text>}
          {obscured && (
            <View pointerEvents="box-none" style={[styles.overlay, {
              transform: [{ translateX: (insets.right - insets.left) / 2 },
                { translateY: (insets.bottom - insets.top) / 2 }],
            }]}>
              <View style={[styles.overlayCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.overlayTitle, { color: theme.text }]}>{game.end ?? 'Paused'}</Text>
                {game.end && <Text style={{ color: theme.muted }}>Score {game.score}</Text>}
                <Button title={game.end ? 'Play again' : 'Resume game'} theme={theme} primary
                  onPress={game.end ? () => begin(game.mode, game.minutes) : resume} />
              </View>
            </View>
          )}
        </View>
      ))}

      {screen && (
        <View style={styles.subpage} {...edgeBack}>
          <View style={styles.page}>
            <Text style={[styles.title, { color: theme.text }]}>{modalTitle}</Text>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
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
              </>}
            </ScrollView>
            {screen === 'modes' && <Button title="Start new game" theme={theme} primary onPress={() => begin(mode, minutes)} />}
            {screen === 'reset' && <Button title="Save score and reset" theme={theme} primary onPress={() => begin(game.mode, game.minutes)} />}
            <Button title="Done" theme={theme} primary={screen === 'settings' || screen === 'scores'} onPress={closeScreen} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><GameScreen /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flex: 1, width: '100%', maxWidth: 540, alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 4, gap: Platform.OS === 'web' ? 4 : 10 },
  subpage: { flex: 1 },
  scroll: { flex: 1 },
  title: { fontSize: 27, fontWeight: '900', letterSpacing: -0.8 },
  stats: { flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, padding: 4 },
  modeStat: { flex: 1.25 },
  modeValue: { fontSize: 15 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  statValue: { fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
  preview: { height: 28, justifyContent: 'center', alignItems: 'center' },
  playfield: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  board: { borderWidth: 1, borderRadius: 7, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 10 },
  overlayTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  overlayCard: { alignItems: 'center', padding: 18, gap: 10, borderWidth: 1, borderRadius: 16 },
  clearScore: { position: 'absolute', alignSelf: 'center', fontSize: 20, fontWeight: '900',
    paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  padArea: { position: 'absolute', bottom: 4, left: 0, right: 0 },
  toolbar: { flexDirection: 'row', gap: 3, borderRadius: 21, borderWidth: 1, padding: 3 },
  toolbarButton: { flex: 1, minHeight: 56, justifyContent: 'center', alignItems: 'center', gap: 2, borderRadius: 16 },
  toolbarIcon: { width: 38, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 23, fontWeight: '700' },
  toolbarLabel: { fontSize: 13, fontWeight: '700' },
  button: { borderWidth: 1, borderRadius: 11, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  buttonText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  modalBody: { gap: 14, paddingVertical: 14 },
  option: { gap: 8 },
  wrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  record: { padding: 12, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
