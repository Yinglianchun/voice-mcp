/**
 * voice-mcp
 *
 * An MCP server for AI voice synthesis with inline audio player.
 * Supports DashScope Qwen-TTS Voice Cloning API.
 *
 * GitHub: https://github.com/garan0613/voice-mcp
 * License: MIT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

export interface Env {
  TTS_PROVIDER?: string;
  DASHSCOPE_API_KEY?: string;
  VOICE_ID?: string;
  TTS_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_VOICE_ID_ZH?: string;
  ELEVENLABS_VOICE_ID_EN?: string;
  ELEVENLABS_MODEL_ID?: string;
  ELEVENLABS_OUTPUT_FORMAT?: string;
  ELEVENLABS_LANGUAGE_CODE?: string;
  ELEVENLABS_LANGUAGE_CODE_ZH?: string;
  ELEVENLABS_LANGUAGE_CODE_EN?: string;
  ELEVENLABS_STABILITY?: string;
  ELEVENLABS_SIMILARITY_BOOST?: string;
  ELEVENLABS_STYLE?: string;
  ELEVENLABS_USE_SPEAKER_BOOST?: string;
  ELEVENLABS_SPEED?: string;
  BOT_NAME?: string;
}

type TtsProvider = "dashscope" | "elevenlabs";
type ElevenLabsLanguage = "zh" | "en";

interface SpeakInput {
  text: string;
  style?: string;
  raw_tags?: boolean;
}

interface AudioResult {
  success: boolean;
  audio_base64?: string;
  alignment?: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
  final_text?: string;
  error?: string;
}

interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface CaptionCue {
  text: string;
  start: number;
  end: number;
}

interface VoiceEvent {
  id: string;
  text: string;
  audio_base64: string;
  created_at: string;
  provider: TtsProvider;
  model_id: string;
  history_item_id?: string;
  caption_cues?: CaptionCue[];
  style?: string;
  raw_tags?: boolean;
}

interface ElevenLabsVoiceSelection {
  voiceId?: string;
  language: ElevenLabsLanguage;
  languageCode?: string;
}

interface ElevenLabsHistoryItem {
  history_item_id?: string;
  date_unix?: number;
  voice_id?: string | null;
  model_id?: string | null;
  voice_name?: string | null;
  text?: string | null;
  alignments?: unknown;
  dialogue?: Array<Record<string, unknown>> | null;
}

// =============================================================================
// Constants
// =============================================================================

const EXT_APPS_MIME = "text/html;profile=mcp-app" as const;
const VOICE_RESOURCE_URI = "ui://voice-mcp/player.html";
const LATEST_VOICE_CACHE_PATH = "/__voice-mcp/latest-voice-event";

// =============================================================================
// Audio Player HTML (WeChat-style UI)
// =============================================================================

function getPlayerHTML(botName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Player</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: transparent;
      padding: 8px;
    }
    .container {
      background: #fff;
      border-radius: 16px;
      padding: 14px 16px;
      max-width: 100%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .player {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
    }
    .play-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: #f5f5f5;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    .play-btn:hover { background: #eee; }
    .play-btn:active { background: #e0e0e0; }
    .play-btn svg { width: 14px; height: 14px; fill: #333; }
    .play-btn.playing svg { fill: #07c160; }
    .waveform {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 2px;
      height: 24px;
    }
    .wave-bar {
      width: 3px;
      background: #d0d0d0;
      border-radius: 2px;
      transition: background 0.1s;
    }
    .wave-bar.active { background: #07c160; }
    .duration {
      font-size: 13px;
      color: #999;
      min-width: 36px;
      text-align: right;
    }
    .toggle-btn {
      background: none;
      border: none;
      color: #07c160;
      font-size: 12px;
      cursor: pointer;
      padding: 8px 0 4px 0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toggle-btn:hover { text-decoration: underline; }
    .toggle-btn .arrow { 
      display: inline-block;
      transition: transform 0.2s; 
      font-size: 10px;
    }
    .toggle-btn.expanded .arrow { transform: rotate(90deg); }
    .text-bubble {
      background: #f7f7f7;
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 8px;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      display: none;
    }
    .text-bubble.show { display: block; }
    .loading {
      text-align: center;
      color: #999;
      font-size: 13px;
      padding: 16px;
    }
    .error {
      color: #fa5151;
      background: #fff2f2;
      padding: 10px;
      border-radius: 8px;
      font-size: 13px;
    }
    @media (prefers-color-scheme: dark) {
      .container { background: #2c2c2c; }
      .play-btn { background: #3a3a3a; }
      .play-btn svg { fill: #e0e0e0; }
      .wave-bar { background: #555; }
      .wave-bar.active { background: #4cd964; }
      .duration { color: #888; }
      .text-bubble { background: #3a3a3a; color: #e0e0e0; }
      .toggle-btn { color: #4cd964; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="content">
      <div class="loading">Loading...</div>
    </div>
  </div>

  <script>
    const contentEl = document.getElementById('content');
    const BOT_NAME = '${botName}';
    let audio = null;
    let waveInterval = null;
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function showError(msg) {
      contentEl.innerHTML = '<div class="error">' + escapeHtml(msg) + '</div>';
    }
    
    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    
    function createWaveform() {
      const heights = [40, 70, 55, 85, 45, 90, 60, 75, 50, 80, 65, 55, 70, 45, 85, 50];
      return heights.map(h => '<div class="wave-bar" style="height:' + h + '%"></div>').join('');
    }
    
    function renderPlayer(text, audioBase64) {
      const audioUrl = 'data:audio/mpeg;base64,' + audioBase64;
      
      contentEl.innerHTML = 
        '<div class="player">' +
          '<button class="play-btn" id="playBtn">' +
            '<svg viewBox="0 0 24 24"><path id="playIcon" d="M8 5v14l11-7z"/></svg>' +
          '</button>' +
          '<div class="waveform" id="waveform">' + createWaveform() + '</div>' +
          '<span class="duration" id="duration">0:00</span>' +
        '</div>' +
        '<button class="toggle-btn" id="toggleBtn">' +
          '<span class="arrow">▶</span> Show transcript' +
        '</button>' +
        '<div class="text-bubble" id="textBubble">' + escapeHtml(text) + '</div>' +
        '<audio id="audio" src="' + audioUrl + '" preload="metadata"></audio>';
      
      audio = document.getElementById('audio');
      const playBtn = document.getElementById('playBtn');
      const playIcon = document.getElementById('playIcon');
      const durationEl = document.getElementById('duration');
      const waveform = document.getElementById('waveform');
      const bars = waveform.querySelectorAll('.wave-bar');
      const toggleBtn = document.getElementById('toggleBtn');
      const textBubble = document.getElementById('textBubble');
      
      audio.addEventListener('loadedmetadata', function() {
        durationEl.textContent = formatTime(audio.duration);
      });
      
      playBtn.addEventListener('click', function() {
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      });
      
      audio.addEventListener('play', function() {
        playBtn.classList.add('playing');
        playIcon.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
        animateWave(bars, true);
      });
      
      audio.addEventListener('pause', function() {
        playBtn.classList.remove('playing');
        playIcon.setAttribute('d', 'M8 5v14l11-7z');
        animateWave(bars, false);
      });
      
      audio.addEventListener('ended', function() {
        playBtn.classList.remove('playing');
        playIcon.setAttribute('d', 'M8 5v14l11-7z');
        animateWave(bars, false);
        bars.forEach(b => b.classList.remove('active'));
      });
      
      audio.addEventListener('timeupdate', function() {
        const progress = audio.currentTime / audio.duration;
        const activeCount = Math.floor(progress * bars.length);
        bars.forEach((b, i) => b.classList.toggle('active', i < activeCount));
      });
      
      toggleBtn.addEventListener('click', function() {
        const isShow = textBubble.classList.toggle('show');
        toggleBtn.classList.toggle('expanded', isShow);
        toggleBtn.innerHTML = isShow 
          ? '<span class="arrow">▶</span> Hide transcript' 
          : '<span class="arrow">▶</span> Show transcript';
      });
    }
    
    function animateWave(bars, playing) {
      if (waveInterval) clearInterval(waveInterval);
      if (!playing) return;
      
      waveInterval = setInterval(function() {
        bars.forEach(bar => {
          if (!bar.classList.contains('active')) {
            bar.style.opacity = 0.5 + Math.random() * 0.5;
          }
        });
      }, 150);
    }
    
    function handleData(data) {
      if (data.error) { showError(data.error); return; }
      if (data.audio_base64 && data.text) {
        renderPlayer(data.text, data.audio_base64);
      }
    }
    
    function sendToHost(method, params, id) {
      const msg = { jsonrpc: '2.0', method: method, params: params || {} };
      if (id !== undefined) msg.id = id;
      window.parent.postMessage(msg, '*');
    }
    
    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      
      if (msg.jsonrpc === '2.0') {
        if (msg.method === 'ui/notifications/tool-input') {
          contentEl.innerHTML = '<div class="loading">Generating voice...</div>';
        }
        if (msg.method === 'ui/notifications/tool-result') {
          const structured = msg.params?.structuredContent;
          if (structured) handleData(structured);
        }
      }
      if (msg.structuredContent) handleData(msg.structuredContent);
    });
    
    sendToHost('ui/initialize', { name: 'voice-mcp', version: '1.0.0' }, 1);
    setTimeout(function() { sendToHost('ui/notifications/initialized', {}); }, 50);
  </script>
</body>
</html>`;
}

function getPanelHTML(botName: string): string {
  const serializedBotName = JSON.stringify(botName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Panel</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      color-scheme: dark;
      --bg: oklch(0.16 0.018 174);
      --surface: oklch(0.22 0.018 174);
      --surface-2: oklch(0.27 0.018 174);
      --line: oklch(0.42 0.018 174);
      --text: oklch(0.93 0.018 174);
      --muted: oklch(0.72 0.018 174);
      --faint: oklch(0.55 0.018 174);
      --accent: oklch(0.73 0.16 156);
      --accent-soft: oklch(0.28 0.07 156);
      --danger: oklch(0.72 0.18 28);
      --radius: 18px;
      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 12px;
      --space-lg: 16px;
      --space-xl: 24px;
      --space-2xl: 32px;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    html, body {
      min-height: 100%;
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    body {
      display: grid;
      place-items: start center;
      padding: clamp(16px, 4vw, 36px);
    }
    button, textarea, select {
      font: inherit;
    }
    button {
      color: inherit;
    }
    .shell {
      width: min(760px, 100%);
      display: grid;
      gap: var(--space-lg);
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
    }
    .identity {
      display: grid;
      gap: var(--space-xs);
    }
    h1 {
      margin: 0;
      font-size: 1.35rem;
      line-height: 1.1;
      font-weight: 740;
      letter-spacing: 0;
    }
    .status {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-sm);
      color: var(--muted);
      font-size: 0.86rem;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--faint);
      box-shadow: 0 0 0 4px color-mix(in oklch, var(--faint), transparent 82%);
    }
    .dot.ready {
      background: var(--accent);
      box-shadow: 0 0 0 4px color-mix(in oklch, var(--accent), transparent 82%);
    }
    .composer {
      display: grid;
      gap: var(--space-md);
      padding: var(--space-lg);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: color-mix(in oklch, var(--surface), transparent 8%);
    }
    label {
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 650;
    }
    textarea {
      width: 100%;
      min-height: 132px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px 15px;
      background: oklch(0.18 0.018 174);
      color: var(--text);
      line-height: 1.55;
      outline: none;
    }
    textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent), transparent 78%);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
    }
    .style-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
    }
    .style-button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      padding: 0 12px;
      cursor: pointer;
    }
    .style-button[aria-pressed="true"] {
      border-color: color-mix(in oklch, var(--accent), var(--line) 25%);
      background: var(--accent-soft);
      color: var(--text);
    }
    .raw-tags {
      display: none;
      align-items: center;
      gap: var(--space-sm);
      color: var(--muted);
      font-size: 0.9rem;
    }
    .raw-tags.available {
      display: flex;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-md);
    }
    .submit {
      min-height: 40px;
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: oklch(0.15 0.04 156);
      padding: 0 18px;
      font-weight: 760;
      cursor: pointer;
    }
    .submit:disabled {
      cursor: wait;
      opacity: 0.7;
    }
    .message {
      min-height: 22px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .message.error {
      color: var(--danger);
    }
    .clips {
      display: grid;
      gap: var(--space-md);
    }
    .voice-item {
      display: grid;
      gap: var(--space-md);
      padding: var(--space-lg);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
    }
    .voice-head {
      display: flex;
      justify-content: space-between;
      gap: var(--space-md);
      color: var(--muted);
      font-size: 0.86rem;
    }
    .voice-bar {
      display: grid;
      grid-template-columns: 42px 1fr 48px;
      align-items: center;
      gap: var(--space-md);
    }
    .play {
      width: 42px;
      height: 42px;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--accent);
      color: oklch(0.15 0.04 156);
      cursor: pointer;
    }
    .play svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .waveform {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 3px;
      overflow: hidden;
    }
    .waveform span {
      width: 4px;
      min-width: 4px;
      border-radius: 999px;
      background: color-mix(in oklch, var(--muted), transparent 48%);
      transition: background 120ms ease, transform 120ms ease;
    }
    .waveform span.active {
      background: var(--accent);
      transform: scaleY(1.08);
    }
    .duration {
      color: var(--muted);
      text-align: right;
      font-size: 0.9rem;
      font-variant-numeric: tabular-nums;
    }
    .transcript {
      color: var(--text);
      line-height: 1.58;
      word-break: break-word;
    }
    .empty {
      min-height: 88px;
      display: grid;
      place-items: center;
      color: var(--faint);
      border: 1px dashed color-mix(in oklch, var(--line), transparent 20%);
      border-radius: var(--radius);
    }
    @media (max-width: 560px) {
      body { padding: 12px; }
      .topbar, .controls, .actions { align-items: stretch; }
      .topbar, .controls { flex-direction: column; }
      .submit { width: 100%; }
      .voice-bar { grid-template-columns: 42px 1fr; }
      .duration { grid-column: 2; text-align: left; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar">
      <div class="identity">
        <h1><span id="botName"></span> voice</h1>
        <div class="status">
          <span class="dot" id="statusDot"></span>
          <span id="statusText">Checking provider</span>
        </div>
      </div>
    </div>

    <form class="composer" id="voiceForm">
      <label for="voiceText">Text</label>
      <textarea id="voiceText" name="text" autocomplete="off" spellcheck="false">小雨，我在。</textarea>

      <div class="controls">
        <div>
          <label>Style</label>
          <div class="style-row" id="styleRow">
            <button class="style-button" type="button" data-style="" aria-pressed="true">plain</button>
            <button class="style-button" type="button" data-style="soft" aria-pressed="false">soft</button>
            <button class="style-button" type="button" data-style="teasing" aria-pressed="false">teasing</button>
            <button class="style-button" type="button" data-style="tired" aria-pressed="false">tired</button>
            <button class="style-button" type="button" data-style="laughing" aria-pressed="false">laughing</button>
          </div>
        </div>
        <div class="actions">
          <label class="raw-tags" id="rawTagsWrap">
            <input type="checkbox" id="rawTags">
            raw tags
          </label>
          <button class="submit" id="submitButton" type="submit">Generate</button>
        </div>
      </div>
      <div class="message" id="message"></div>
    </form>

    <section class="clips" id="clips">
      <div class="empty">No voice yet</div>
    </section>
  </main>

  <script>
    const BOT_NAME = ${serializedBotName};
    const PLAY_PATH = 'M8 5v14l11-7z';
    const PAUSE_PATH = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
    const WAVE_HEIGHTS = [34, 66, 46, 82, 42, 76, 58, 92, 48, 72, 38, 64, 88, 44, 70, 52, 80, 36, 62, 90, 50, 74, 40, 68];
    const clips = [];
    let selectedStyle = '';

    const botNameEl = document.getElementById('botName');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const form = document.getElementById('voiceForm');
    const voiceText = document.getElementById('voiceText');
    const styleRow = document.getElementById('styleRow');
    const rawTagsWrap = document.getElementById('rawTagsWrap');
    const rawTags = document.getElementById('rawTags');
    const submitButton = document.getElementById('submitButton');
    const message = document.getElementById('message');
    const clipsEl = document.getElementById('clips');

    botNameEl.textContent = BOT_NAME;

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function setMessage(text, isError) {
      message.textContent = text || '';
      message.classList.toggle('error', Boolean(isError));
    }

    function humanizeError(text) {
      const match = text.match(/\\{.*\\}$/);
      if (!match) return text;
      try {
        const parsed = JSON.parse(match[0]);
        return parsed.detail?.message || text;
      } catch (_) {
        return text;
      }
    }

    function formatTime(sec) {
      if (!Number.isFinite(sec) || sec <= 0) return '0:00';
      const minutes = Math.floor(sec / 60);
      const seconds = Math.floor(sec % 60);
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    function formatEventTime(value) {
      if (!value) return 'no signal';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'received';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function createWaveform() {
      return WAVE_HEIGHTS.map((height) => '<span style="height:' + height + '%"></span>').join('');
    }

    function setStyle(style) {
      selectedStyle = style;
      styleRow.querySelectorAll('.style-button').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.style === selectedStyle ? 'true' : 'false');
      });
    }

    async function loadStatus() {
      try {
        const response = await fetch('/status');
        const data = await response.json();
        statusDot.classList.toggle('ready', Boolean(data.configured));
        statusText.textContent = data.provider + ' · ' + data.model_id;
        rawTagsWrap.classList.toggle('available', Boolean(data.audio_tags_enabled));
        if (!data.audio_tags_enabled) rawTags.checked = false;
        if (!data.configured) setMessage('Provider is not configured', true);
      } catch (error) {
        statusText.textContent = 'Status unavailable';
        setMessage(error instanceof Error ? error.message : String(error), true);
      }
    }

    function buildSpeakUrl(text) {
      const speakUrl = new URL('/speak', window.location.origin);
      speakUrl.searchParams.set('text', text);
      if (selectedStyle) speakUrl.searchParams.set('style', selectedStyle);
      if (rawTags.checked) speakUrl.searchParams.set('raw_tags', 'true');
      return speakUrl;
    }

    function renderClip(text, blob) {
      const objectUrl = URL.createObjectURL(blob);
      clips.unshift({ text, objectUrl });
      while (clips.length > 8) {
        const oldClip = clips.pop();
        URL.revokeObjectURL(oldClip.objectUrl);
      }

      clipsEl.innerHTML = clips.map((clip, index) => (
        '<article class="voice-item" data-index="' + index + '">' +
          '<div class="voice-head">' +
            '<span>' + BOT_NAME + '</span>' +
            '<span class="clip-status">ready</span>' +
          '</div>' +
          '<div class="voice-bar">' +
            '<button class="play" type="button" aria-label="Play voice">' +
              '<svg viewBox="0 0 24 24"><path d="' + PLAY_PATH + '"></path></svg>' +
            '</button>' +
            '<div class="waveform">' + createWaveform() + '</div>' +
            '<span class="duration">0:00</span>' +
          '</div>' +
          '<div class="transcript">' + escapeHtml(clip.text) + '</div>' +
          '<audio preload="metadata" src="' + clip.objectUrl + '"></audio>' +
        '</article>'
      )).join('');

      clipsEl.querySelectorAll('.voice-item').forEach(wireClip);
    }

    function wireClip(item) {
      const playButton = item.querySelector('.play');
      const icon = playButton.querySelector('path');
      const audio = item.querySelector('audio');
      const duration = item.querySelector('.duration');
      const bars = item.querySelectorAll('.waveform span');

      audio.addEventListener('loadedmetadata', () => {
        duration.textContent = formatTime(audio.duration);
      });

      playButton.addEventListener('click', () => {
        document.querySelectorAll('audio').forEach((otherAudio) => {
          if (otherAudio !== audio) otherAudio.pause();
        });

        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
      });

      audio.addEventListener('play', () => {
        icon.setAttribute('d', PAUSE_PATH);
      });

      audio.addEventListener('pause', () => {
        icon.setAttribute('d', PLAY_PATH);
      });

      audio.addEventListener('ended', () => {
        icon.setAttribute('d', PLAY_PATH);
        bars.forEach((bar) => bar.classList.remove('active'));
      });

      audio.addEventListener('timeupdate', () => {
        const progress = audio.duration ? audio.currentTime / audio.duration : 0;
        const activeCount = Math.floor(progress * bars.length);
        bars.forEach((bar, index) => bar.classList.toggle('active', index < activeCount));
      });
    }

    styleRow.addEventListener('click', (event) => {
      const button = event.target.closest('.style-button');
      if (!button) return;
      setStyle(button.dataset.style || '');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = voiceText.value.trim();
      if (!text) {
        setMessage('Text is empty', true);
        return;
      }

      submitButton.disabled = true;
      setMessage('Generating');

      try {
        const response = await fetch(buildSpeakUrl(text));
        if (!response.ok) {
          let detail = 'Voice generation failed';
          try {
            const data = await response.json();
            detail = data.error || detail;
          } catch (_) {}
          throw new Error(detail);
        }

        const blob = await response.blob();
        renderClip(text, blob);
        setMessage('Ready');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error), true);
      } finally {
        submitButton.disabled = false;
      }
    });

    voiceText.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        form.requestSubmit();
      }
    });

    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.has('text')) voiceText.value = initialParams.get('text') || '';
    if (initialParams.has('style')) setStyle(initialParams.get('style') || '');
    if (initialParams.get('raw_tags') === 'true') rawTags.checked = true;

    loadStatus();
  </script>
</body>
</html>`;
}

function getVisualizerPanelHTML(botName: string): string {
  const serializedBotName = JSON.stringify(botName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Visualizer</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      color-scheme: dark;
      --bg: oklch(0.075 0.012 220);
      --ink: oklch(0.92 0.012 210);
      --muted: oklch(0.68 0.02 218);
      --faint: oklch(0.45 0.022 218);
      --panel: oklch(0.14 0.015 220 / 0.84);
      --panel-strong: oklch(0.18 0.018 220 / 0.92);
      --line: oklch(0.37 0.026 218 / 0.56);
      --ice: oklch(0.82 0.075 196);
      --green: oklch(0.77 0.14 154);
      --rose: oklch(0.68 0.17 18);
      --danger: oklch(0.72 0.18 28);
      --space-xs: 4px;
      --space-sm: 8px;
      --space-md: 12px;
      --space-lg: 16px;
      --space-xl: 24px;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    html, body {
      width: 100%;
      min-height: 100%;
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      overflow-x: hidden;
    }
    body {
      min-height: 100vh;
    }
    button, input, textarea {
      font: inherit;
    }
    button {
      color: inherit;
    }
    .stage {
      position: relative;
      min-height: 100vh;
      isolation: isolate;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 42%, oklch(0.2 0.055 196 / 0.42), transparent 34%),
        radial-gradient(circle at 20% 12%, oklch(0.2 0.035 154 / 0.18), transparent 30%),
        linear-gradient(180deg, oklch(0.08 0.012 220), oklch(0.05 0.01 220));
    }
    .stage::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -2;
      opacity: 0.26;
      background-image:
        linear-gradient(oklch(0.32 0.02 220 / 0.22) 1px, transparent 1px),
        linear-gradient(90deg, oklch(0.32 0.02 220 / 0.18) 1px, transparent 1px);
      background-size: 72px 72px;
      mask-image: radial-gradient(circle at center, black, transparent 72%);
    }
    .stage::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      background: radial-gradient(circle at center, transparent 28%, oklch(0.025 0.006 220 / 0.82) 86%);
    }
    canvas {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      display: block;
    }
    .hud {
      position: relative;
      z-index: 2;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: var(--space-md);
      padding: clamp(16px, 3vw, 32px);
      pointer-events: none;
    }
    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-md);
    }
    .brand {
      display: grid;
      gap: var(--space-sm);
      max-width: 28rem;
    }
    .eyebrow {
      color: var(--faint);
      font-size: 0.76rem;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.18em;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.7rem, 4.6vw, 3.8rem);
      line-height: 0.92;
      letter-spacing: 0;
      font-weight: 780;
    }
    .sub {
      color: var(--muted);
      font-size: clamp(0.9rem, 1.4vw, 1rem);
      line-height: 1.45;
      max-width: 34ch;
    }
    .status {
      min-width: 178px;
      display: grid;
      gap: var(--space-xs);
      justify-items: end;
      color: var(--muted);
      font-size: 0.84rem;
      text-align: right;
    }
    .signal {
      display: inline-flex;
      align-items: center;
      gap: var(--space-sm);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--faint);
      box-shadow: 0 0 18px var(--faint);
    }
    .dot.ready {
      background: var(--green);
      box-shadow: 0 0 24px var(--green);
    }
    .center-note {
      align-self: center;
      width: min(36rem, 82vw);
      margin: 0 auto;
      display: grid;
      justify-items: center;
      gap: var(--space-md);
      color: oklch(0.88 0.03 206 / 0.84);
      text-align: center;
      text-shadow: 0 0 28px oklch(0.78 0.08 196 / 0.42);
    }
    .energy {
      font-size: 0.78rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .caption {
      max-width: min(50ch, 84vw);
      min-height: 3.2em;
      font-size: clamp(1rem, 2vw, 1.45rem);
      line-height: 1.45;
      display: grid;
      place-items: center;
      white-space: normal;
    }
    .caption-line {
      display: block;
      animation: captionLineIn 360ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes captionLineIn {
      from {
        opacity: 0;
        transform: translateY(8px);
        filter: blur(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
      }
    }
    .dock {
      pointer-events: auto;
      width: min(900px, 100%);
      margin: 0 auto;
      display: grid;
      gap: var(--space-md);
      padding: var(--space-md);
      border: 1px solid var(--line);
      border-radius: 24px;
      background: color-mix(in oklch, var(--panel), transparent 4%);
      backdrop-filter: blur(18px);
      box-shadow: 0 24px 80px oklch(0.02 0.008 220 / 0.58);
      transform-origin: bottom center;
      transition:
        opacity 260ms ease,
        transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
        filter 260ms ease;
    }
    .dock.is-hidden {
      pointer-events: none;
      opacity: 0;
      transform: translateY(calc(100% + 28px)) scale(0.98);
      filter: blur(8px);
    }
    .receiver {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      color: var(--muted);
      min-height: 28px;
    }
    .receiver-title {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      font-size: 0.84rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .receiver-actions {
      display: flex;
      align-items: center;
      gap: var(--space-md);
    }
    .receiver-time {
      font-size: 0.84rem;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .dock-close {
      width: 30px;
      height: 30px;
      border: 1px solid color-mix(in oklch, var(--line), transparent 10%);
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: oklch(0.08 0.012 220 / 0.68);
      color: var(--muted);
      cursor: pointer;
    }
    .dock-close:hover,
    .dock-close:focus-visible {
      color: var(--ice);
      border-color: color-mix(in oklch, var(--ice), var(--line) 30%);
      outline: none;
    }
    .dock-close svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
    }
    .pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--faint);
      box-shadow: 0 0 18px var(--faint);
    }
    .pulse.live {
      background: var(--green);
      box-shadow: 0 0 28px var(--green);
      animation: pulseGlow 1.8s ease-out infinite;
    }
    @keyframes pulseGlow {
      0% { transform: scale(0.85); opacity: 0.75; }
      50% { transform: scale(1.12); opacity: 1; }
      100% { transform: scale(0.85); opacity: 0.75; }
    }
    .prompt {
      display: none;
      gap: var(--space-sm);
    }
    .history-loader {
      display: grid;
      gap: var(--space-sm);
    }
    .history-label {
      color: var(--muted);
      font-size: 0.78rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .history-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-sm);
      align-items: center;
    }
    .history-input {
      min-height: 40px;
      width: 100%;
      border: 1px solid color-mix(in oklch, var(--line), transparent 10%);
      border-radius: 999px;
      padding: 0 14px;
      background: oklch(0.08 0.012 220 / 0.76);
      color: var(--ink);
      outline: none;
    }
    .history-input:focus {
      border-color: var(--ice);
      box-shadow: 0 0 0 3px oklch(0.72 0.08 196 / 0.18);
    }
    .history-load {
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: oklch(0.1 0.014 220 / 0.72);
      color: var(--ice);
      padding: 0 14px;
      font-weight: 720;
      cursor: pointer;
    }
    .history-load:disabled {
      cursor: wait;
      opacity: 0.66;
    }
    label {
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 680;
    }
    textarea {
      width: 100%;
      min-height: 58px;
      max-height: 138px;
      resize: vertical;
      border: 1px solid color-mix(in oklch, var(--line), transparent 10%);
      border-radius: 18px;
      padding: 14px 15px;
      background: oklch(0.08 0.012 220 / 0.76);
      color: var(--ink);
      line-height: 1.55;
      outline: none;
    }
    textarea:focus {
      border-color: var(--ice);
      box-shadow: 0 0 0 3px oklch(0.72 0.08 196 / 0.18);
    }
    .controls {
      display: none;
      grid-template-columns: 1fr auto;
      gap: var(--space-md);
      align-items: end;
    }
    .style-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-sm);
    }
    .style-button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: transparent;
      color: var(--muted);
      padding: 0 12px;
      cursor: pointer;
    }
    .style-button[aria-pressed="true"] {
      border-color: color-mix(in oklch, var(--ice), var(--line) 20%);
      background: oklch(0.25 0.05 196 / 0.48);
      color: var(--ink);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-md);
    }
    .raw-tags {
      display: none;
      align-items: center;
      gap: var(--space-sm);
      color: var(--muted);
      font-size: 0.88rem;
      white-space: nowrap;
    }
    .raw-tags.available {
      display: flex;
    }
    .generate {
      min-height: 42px;
      border: 0;
      border-radius: 999px;
      background: var(--ice);
      color: oklch(0.12 0.028 216);
      padding: 0 18px;
      font-weight: 760;
      cursor: pointer;
    }
    .generate:disabled {
      cursor: wait;
      opacity: 0.7;
    }
    .transport {
      display: grid;
      grid-template-columns: 50px 1fr 42px 54px;
      align-items: center;
      gap: var(--space-md);
      min-height: 48px;
    }
    .play {
      width: 50px;
      height: 50px;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--green);
      color: oklch(0.11 0.03 154);
      cursor: pointer;
      box-shadow: 0 0 32px oklch(0.77 0.14 154 / 0.3);
    }
    .play:disabled {
      cursor: not-allowed;
      background: oklch(0.28 0.03 154);
      color: oklch(0.58 0.035 154);
      box-shadow: none;
      opacity: 0.72;
    }
    .play svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .download {
      width: 42px;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: oklch(0.1 0.014 220 / 0.72);
      color: var(--ice);
      cursor: pointer;
    }
    .download:disabled {
      cursor: not-allowed;
      color: var(--faint);
      opacity: 0.62;
    }
    .download svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .track {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 3px;
      overflow: hidden;
    }
    .track span {
      width: 4px;
      min-width: 4px;
      border-radius: 999px;
      background: oklch(0.72 0.04 200 / 0.28);
      transform-origin: center;
      transition: background 140ms ease, transform 140ms ease;
    }
    .track span.active {
      background: var(--ice);
      transform: scaleY(1.1);
    }
    .time {
      color: var(--muted);
      text-align: right;
      font-size: 0.9rem;
      font-variant-numeric: tabular-nums;
    }
    .message {
      min-height: 22px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .message.error {
      color: var(--danger);
    }
    @media (max-width: 700px) {
      .hud { padding: 14px; }
      .top { flex-direction: column; }
      .status { justify-items: start; text-align: left; }
      .receiver { align-items: flex-start; }
      .receiver-actions { gap: var(--space-sm); }
      .history-row { grid-template-columns: 1fr; }
      .controls { grid-template-columns: 1fr; }
      .actions { justify-content: space-between; }
      .transport { grid-template-columns: 50px 1fr 42px; }
      .time { grid-column: 2 / 4; text-align: left; }
    }
    @media (prefers-reduced-motion: reduce) {
      .caption-line,
      .pulse.live {
        animation: none;
      }
    }
  </style>
</head>
<body>
  <main class="stage">
    <canvas id="visualizer"></canvas>
    <div class="hud">
      <header class="top">
        <div class="brand">
          <div class="eyebrow">voice archive / live signal</div>
          <h1 id="title">HAVEN</h1>
          <div class="sub">A breathing audio field for Haven. Generate a line, press play, and let the voice disturb the shape.</div>
        </div>
        <div class="status">
          <span class="signal"><span class="dot" id="statusDot"></span><span id="statusText">checking provider</span></span>
          <span id="modelText"></span>
        </div>
      </header>

      <section class="center-note">
        <div class="energy" id="energyText">idle drift</div>
        <div class="caption" id="caption">等哥哥说话。</div>
      </section>

      <section class="dock" id="dockPanel">
        <div class="receiver">
          <div class="receiver-title"><span class="pulse" id="receiverPulse"></span><span id="receiverText">waiting for MCP voice</span></div>
          <div class="receiver-actions">
            <div class="receiver-time" id="eventTime">no signal</div>
            <button class="dock-close" id="dockCloseButton" type="button" aria-label="Hide controls" title="Hide controls">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12"></path>
                <path d="M18 6L6 18"></path>
              </svg>
            </button>
          </div>
        </div>

        <form class="history-loader" id="historyForm">
          <label class="history-label" for="historyId">ElevenLabs history id</label>
          <div class="history-row">
            <input class="history-input" id="historyId" name="history_id" autocomplete="off" spellcheck="false" placeholder="KBKoxwRtRx2Mi0NucpGV">
            <button class="history-load" id="historyLoadButton" type="submit">Load</button>
          </div>
        </form>

        <div class="transport">
          <button class="play" id="playButton" type="button" aria-label="Play voice" disabled>
            <svg viewBox="0 0 24 24"><path id="playIcon" d="M8 5v14l11-7z"></path></svg>
          </button>
          <div class="track" id="track"></div>
          <button class="download" id="downloadButton" type="button" aria-label="Download MP3" title="Download MP3" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11"></path>
              <path d="m7 10 5 5 5-5"></path>
              <path d="M5 21h14"></path>
            </svg>
          </button>
          <div class="time" id="time">0:00</div>
        </div>
        <div class="message" id="message"></div>
        <audio id="audio" preload="metadata"></audio>
      </section>
    </div>
  </main>

  <script>
    const BOT_NAME = ${serializedBotName};
    const PLAY_PATH = 'M8 5v14l11-7z';
    const PAUSE_PATH = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';
    const WAVE_HEIGHTS = [34, 66, 46, 82, 42, 76, 58, 92, 48, 72, 38, 64, 88, 44, 70, 52, 80, 36, 62, 90, 50, 74, 40, 68, 58, 78, 44, 84, 36, 70, 52, 90];

    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');
    const stage = document.querySelector('.stage');
    const title = document.getElementById('title');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const modelText = document.getElementById('modelText');
    const energyText = document.getElementById('energyText');
    const caption = document.getElementById('caption');
    const receiverPulse = document.getElementById('receiverPulse');
    const receiverText = document.getElementById('receiverText');
    const eventTime = document.getElementById('eventTime');
    const dockPanel = document.getElementById('dockPanel');
    const dockCloseButton = document.getElementById('dockCloseButton');
    const historyForm = document.getElementById('historyForm');
    const historyIdInput = document.getElementById('historyId');
    const historyLoadButton = document.getElementById('historyLoadButton');
    const playButton = document.getElementById('playButton');
    const playIcon = document.getElementById('playIcon');
    const downloadButton = document.getElementById('downloadButton');
    const track = document.getElementById('track');
    const time = document.getElementById('time');
    const message = document.getElementById('message');
    const audio = document.getElementById('audio');

    let selectedStyle = '';
    let audioContext = null;
    let analyser = null;
    let sourceNode = null;
    let frequencyData = null;
    let objectUrl = '';
    let downloadName = 'haven-voice.mp3';
    let lastEventId = '';
    let dockHidden = false;
    let captionLines = [];
    let captionCues = [];
    let activeCaptionLineIndex = -1;
    let eventPulse = 0;
    let energy = 0;
    let smoothedEnergy = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];

    title.textContent = BOT_NAME.toUpperCase();
    track.innerHTML = WAVE_HEIGHTS.map((height) => '<span style="height:' + height + '%"></span>').join('');

    function resizeCanvas() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
    }

    function seedParticles() {
      const count = Math.min(170, Math.max(88, Math.floor((window.innerWidth * window.innerHeight) / 9000)));
      particles = Array.from({ length: count }, (_, index) => ({
        angle: Math.random() * Math.PI * 2,
        orbit: 0.25 + Math.random() * 0.82,
        speed: (Math.random() * 0.28 + 0.08) * (index % 2 ? 1 : -1),
        size: Math.random() * 1.9 + 0.5,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function setMessage(text, isError) {
      message.textContent = text || '';
      message.classList.toggle('error', Boolean(isError));
    }

    function setDockVisible(visible) {
      if (!visible && dockPanel.contains(document.activeElement)) {
        document.activeElement.blur();
      }

      dockHidden = !visible;
      dockPanel.classList.toggle('is-hidden', !visible);
      dockPanel.inert = !visible;
      dockPanel.setAttribute('aria-hidden', String(!visible));
    }

    function hideDock() {
      setDockVisible(false);
    }

    function showDock() {
      setDockVisible(true);
    }

    function formatTime(sec) {
      if (!Number.isFinite(sec) || sec <= 0) return '0:00';
      const minutes = Math.floor(sec / 60);
      const seconds = Math.floor(sec % 60);
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    function formatEventTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'live signal';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function padTimePart(value) {
      return String(value).padStart(2, '0');
    }

    function makeFilenameText(text) {
      const invalidChars = ['<', '>', ':', '"', '/', '\\\\', '|', '?', '*'];
      let safe = stripAudioTagsForDisplay(text || '')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 48);

      invalidChars.forEach((char) => {
        safe = safe.split(char).join('');
      });

      return safe
        .replace(/[. ]+$/g, '')
        .replace(/\\s+/g, '-')
        .toLowerCase() || 'voice';
    }

    function createDownloadName(text, createdAt) {
      const date = new Date(createdAt || Date.now());
      const stamp = Number.isNaN(date.getTime())
        ? 'latest'
        : date.getFullYear() + '-' +
          padTimePart(date.getMonth() + 1) + '-' +
          padTimePart(date.getDate()) + '_' +
          padTimePart(date.getHours()) + '-' +
          padTimePart(date.getMinutes()) + '-' +
          padTimePart(date.getSeconds());

      return 'haven-voice-' + stamp + '-' + makeFilenameText(text) + '.mp3';
    }

    function createAudioObjectUrlFromBase64(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    }

    function stripAudioTagsForDisplay(text) {
      return text
        .replace(/\\[[^\\]\\r\\n]{1,80}\\]/g, ' ')
        .replace(/[ \\t]{2,}/g, ' ')
        .replace(/[ \\t]+([,.!?;:，。！？；：])/g, '$1');
    }

    function splitCaptionText(text) {
      const cleaned = stripAudioTagsForDisplay(text)
        .replace(/\\r\\n/g, '\\n')
        .replace(/\\r/g, '\\n');

      return cleaned
        .split(/\\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          if (line.length <= 48) return [line];
          const sentences = line.match(/[^.!?。！？]+[.!?。！？]?/g);
          return sentences ? sentences.map((sentence) => sentence.trim()).filter(Boolean) : [line];
        });
    }

    function showCaptionLine(index) {
      if (!captionLines.length) {
        caption.textContent = '...';
        activeCaptionLineIndex = -1;
        return;
      }

      const nextIndex = Math.max(0, Math.min(index, captionLines.length - 1));
      if (nextIndex === activeCaptionLineIndex) return;
      activeCaptionLineIndex = nextIndex;

      const line = document.createElement('span');
      line.className = 'caption-line';
      line.textContent = captionLines[nextIndex];
      caption.replaceChildren(line);
    }

    function setCaptionText(text, cues) {
      const timedCues = Array.isArray(cues)
        ? cues
          .filter((cue) => cue && typeof cue.text === 'string' && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
          .map((cue) => ({ text: cue.text.trim(), start: cue.start, end: cue.end }))
          .filter((cue) => cue.text)
        : [];

      captionCues = timedCues;
      captionLines = timedCues.length ? timedCues.map((cue) => cue.text) : splitCaptionText(text || '');
      activeCaptionLineIndex = -1;
      showCaptionLine(0);
    }

    function updateCaptionFromAudio() {
      if (!captionLines.length) return;

      if (captionCues.length) {
        const currentTime = audio.currentTime;
        let cueIndex = captionCues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end);

        if (cueIndex === -1) {
          if (currentTime < captionCues[0].start) {
            cueIndex = 0;
          } else {
            cueIndex = captionCues.findIndex((cue) => currentTime < cue.start);
            cueIndex = cueIndex === -1 ? captionCues.length - 1 : Math.max(0, cueIndex - 1);
          }
        }

        showCaptionLine(cueIndex);
        return;
      }

      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const progress = audio.duration ? audio.currentTime / audio.duration : 0;
      const index = Math.min(captionLines.length - 1, Math.floor(progress * captionLines.length));
      showCaptionLine(index);
    }

    function setStyle(style) {
      selectedStyle = style;
    }

    async function loadStatus() {
      try {
        const response = await fetch('/status');
        const data = await response.json();
        statusDot.classList.toggle('ready', Boolean(data.configured));
        statusText.textContent = data.provider || 'unknown';
        modelText.textContent = data.model_id || '';
        if (!data.configured) setMessage('Provider is not configured', true);
      } catch (error) {
        statusText.textContent = 'status unavailable';
        setMessage(error instanceof Error ? error.message : String(error), true);
      }
    }

    function buildSpeakUrl(text) {
      const speakUrl = new URL('/speak', window.location.origin);
      speakUrl.searchParams.set('text', text);
      if (selectedStyle) speakUrl.searchParams.set('style', selectedStyle);
      return speakUrl;
    }

    async function loadHistoryItem(event) {
      event.preventDefault();

      const historyId = historyIdInput.value.trim();
      if (!historyId) {
        setMessage('History ID is empty', true);
        return;
      }

      historyLoadButton.disabled = true;
      receiverText.textContent = 'loading history';
      setMessage('Loading history item');

      try {
        const historyUrl = new URL('/history', window.location.origin);
        historyUrl.searchParams.set('id', historyId);
        const response = await fetch(historyUrl.toString(), { cache: 'no-store' });
        const data = await response.json();

        if (!response.ok || !data.event) {
          throw new Error(data.error || 'History item unavailable');
        }

        receiveVoiceEvent(data.event);
      } catch (error) {
        receiverText.textContent = 'history load failed';
        setMessage(error instanceof Error ? error.message : String(error), true);
      } finally {
        historyLoadButton.disabled = false;
      }
    }

    function receiveVoiceEvent(event) {
      if (!event || event.id === lastEventId || !event.audio_base64) return;
      lastEventId = event.id;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }

      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      objectUrl = createAudioObjectUrlFromBase64(event.audio_base64);
      downloadName = createDownloadName(event.text || '', event.created_at);
      audio.src = objectUrl;
      audio.load();

      const text = event.text || '';
      setCaptionText(text, event.caption_cues);
      playButton.disabled = false;
      downloadButton.disabled = false;
      receiverPulse.classList.add('live');
      receiverText.textContent = 'voice received';
      eventTime.textContent = formatEventTime(event.created_at);
      setMessage('Ready to play');
      eventPulse = 1;
      smoothedEnergy = Math.max(smoothedEnergy, 0.55);
    }

    async function pollLatestVoiceEvent() {
      try {
        const latestUrl = new URL('/events/latest', window.location.origin);
        if (lastEventId) latestUrl.searchParams.set('since', lastEventId);
        const response = await fetch(latestUrl.toString(), { cache: 'no-store' });
        if (!response.ok) throw new Error('Voice event stream unavailable');
        const data = await response.json();
        if (data.event) receiveVoiceEvent(data.event);
        else if (!lastEventId) {
          receiverText.textContent = 'waiting for MCP voice';
          eventTime.textContent = 'no signal';
        }
      } catch (error) {
        receiverPulse.classList.remove('live');
        receiverText.textContent = 'listener paused';
        setMessage(error instanceof Error ? error.message : String(error), true);
      }
    }

    function ensureAudioGraph() {
      if (!audioContext) {
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.78;
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
      }
      if (!sourceNode) {
        sourceNode = audioContext.createMediaElementSource(audio);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
      }
    }

    async function generateVoice() {
      const text = voiceText.value.trim();
      if (!text) {
        setMessage('Text is empty', true);
        return;
      }

      playButton.disabled = true;
      downloadButton.disabled = true;
      setMessage('Generating');
      setCaptionText(text);

      try {
        const response = await fetch(buildSpeakUrl(text));
        if (!response.ok) {
          let detail = 'Voice generation failed';
          try {
            const data = await response.json();
            detail = data.error || detail;
          } catch (_) {}
          throw new Error(detail);
        }

        const blob = await response.blob();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        downloadName = createDownloadName(text, Date.now());
        audio.src = objectUrl;
        playButton.disabled = false;
        downloadButton.disabled = false;
        setMessage('Ready');
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setMessage(humanizeError(text), true);
      } finally {
      }
    }

    function sampleEnergy() {
      if (!analyser || !frequencyData || audio.paused) {
        energy = 0;
        return;
      }

      analyser.getByteFrequencyData(frequencyData);
      let sum = 0;
      for (let i = 2; i < frequencyData.length; i += 2) {
        sum += frequencyData[i];
      }
      energy = Math.min(1, sum / (frequencyData.length * 104));
    }

    function drawBlob(now) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const cx = width * 0.5;
      const cy = height * 0.43;
      const baseRadius = Math.min(width, height) * 0.29;
      const idleBreath = (Math.sin(now * 0.00125) + 1) * 0.5;
      const breath = 0.78 + idleBreath * 0.12 + smoothedEnergy * 0.38;
      const radius = baseRadius * breath;
      const points = 144;

      ctx.save();
      ctx.translate(cx, cy);

      const aura = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius * 2.1);
      aura.addColorStop(0, 'rgba(224, 255, 244, ' + (0.38 + smoothedEnergy * 0.28) + ')');
      aura.addColorStop(0.26, 'rgba(155, 224, 218, ' + (0.2 + smoothedEnergy * 0.22) + ')');
      aura.addColorStop(0.58, 'rgba(80, 132, 130, ' + (0.09 + smoothedEnergy * 0.12) + ')');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const n1 = Math.sin(angle * 3 + now * 0.0012 + layer * 1.9);
          const n2 = Math.sin(angle * 7 - now * 0.0008 + layer * 0.7);
          const n3 = Math.cos(angle * 11 + now * 0.00056);
          const deform = 1 + n1 * 0.08 + n2 * 0.045 + n3 * 0.025 + smoothedEnergy * Math.sin(angle * 5 + now * 0.006) * 0.14;
          const r = radius * (1 + layer * 0.18) * deform;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r * (0.82 + layer * 0.04);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        if (layer === 0) {
          const inner = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.2);
          inner.addColorStop(0, 'rgba(202, 245, 229, ' + (0.12 + smoothedEnergy * 0.12) + ')');
          inner.addColorStop(0.72, 'rgba(74, 119, 118, ' + (0.08 + smoothedEnergy * 0.1) + ')');
          inner.addColorStop(1, 'rgba(5, 12, 15, 0)');
          ctx.fillStyle = inner;
          ctx.fill();
        }
        ctx.strokeStyle = layer === 0
          ? 'rgba(232, 255, 242, ' + (0.46 + smoothedEnergy * 0.36) + ')'
          : 'rgba(166, 230, 234, ' + (0.18 + smoothedEnergy * 0.18) + ')';
        ctx.lineWidth = layer === 0 ? 1.8 : 1;
        ctx.shadowBlur = 34 + layer * 22 + smoothedEnergy * 48;
        ctx.shadowColor = 'rgba(184, 245, 224, 0.55)';
        ctx.stroke();
      }

      particles.forEach((particle) => {
        particle.angle += particle.speed * 0.002 + smoothedEnergy * 0.002;
        const drift = Math.sin(now * 0.001 + particle.phase) * 0.12;
        const orbit = radius * (particle.orbit + drift + smoothedEnergy * 0.2);
        const x = Math.cos(particle.angle) * orbit * 1.45;
        const y = Math.sin(particle.angle) * orbit * 0.88;
        const alpha = 0.18 + smoothedEnergy * 0.42 + Math.max(0, Math.sin(now * 0.0018 + particle.phase)) * 0.2;
        ctx.fillStyle = 'rgba(214, 246, 238, ' + alpha + ')';
        ctx.beginPath();
        ctx.arc(x, y, particle.size + smoothedEnergy * 1.4, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    }

    function render(now) {
      sampleEnergy();
      smoothedEnergy += (energy - smoothedEnergy) * 0.08;
      eventPulse *= 0.94;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = 'rgba(1, 4, 7, 0.34)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      const sampledEnergy = smoothedEnergy;
      smoothedEnergy = Math.max(smoothedEnergy, eventPulse * 0.65);
      drawBlob(now);
      smoothedEnergy = sampledEnergy;

      const state = audio.paused ? 'idle drift' : 'voice bloom ' + Math.round(smoothedEnergy * 100).toString().padStart(2, '0');
      energyText.textContent = state;

      const progress = audio.duration ? audio.currentTime / audio.duration : 0;
      const activeCount = Math.floor(progress * track.children.length);
      Array.from(track.children).forEach((bar, index) => {
        bar.classList.toggle('active', index < activeCount);
        if (!audio.paused) {
          const wobble = 1 + smoothedEnergy * 1.25 + Math.sin(now * 0.006 + index) * smoothedEnergy * 0.42;
          bar.style.transform = 'scaleY(' + wobble.toFixed(3) + ')';
        } else {
          bar.style.transform = '';
        }
      });

      requestAnimationFrame(render);
    }

    playButton.addEventListener('click', async () => {
      ensureAudioGraph();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    });

    downloadButton.addEventListener('click', () => {
      if (!objectUrl || downloadButton.disabled) return;

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage('MP3 downloaded');
    });

    historyForm.addEventListener('submit', loadHistoryItem);

    dockCloseButton.addEventListener('click', hideDock);
    dockPanel.addEventListener('click', (event) => event.stopPropagation());
    stage.addEventListener('click', () => {
      if (dockHidden) showDock();
    });

    audio.addEventListener('play', () => {
      playIcon.setAttribute('d', PAUSE_PATH);
      hideDock();
    });

    audio.addEventListener('pause', () => {
      playIcon.setAttribute('d', PLAY_PATH);
    });

    audio.addEventListener('ended', () => {
      playIcon.setAttribute('d', PLAY_PATH);
    });

    audio.addEventListener('loadedmetadata', () => {
      time.textContent = formatTime(audio.duration);
      updateCaptionFromAudio();
    });

    audio.addEventListener('timeupdate', () => {
      time.textContent = audio.duration ? formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration) : '0:00';
      updateCaptionFromAudio();
    });

    const initialParams = new URLSearchParams(window.location.search);
    if (initialParams.has('style')) setStyle(initialParams.get('style') || '');

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    loadStatus();
    pollLatestVoiceEvent();
    setInterval(pollLatestVoiceEvent, 1000);
    requestAnimationFrame(render);
  </script>
</body>
</html>`;
}

// =============================================================================
// TTS Provider Helpers
// =============================================================================

const ELEVENLABS_V3_STYLE_TAGS: Record<string, string> = {
  soft: "[whispers]",
  teasing: "[mischievously]",
  excited: "[excited]",
  tired: "[sighs]",
  laughing: "[laughs]",
  curious: "[curious]",
};

function getTtsProvider(env: Env): TtsProvider {
  return env.TTS_PROVIDER?.trim().toLowerCase() === "elevenlabs" ? "elevenlabs" : "dashscope";
}

function getDashScopeModel(env: Env): string {
  return env.TTS_MODEL || "cosyvoice-v3.5-plus";
}

function getElevenLabsModel(env: Env): string {
  return env.ELEVENLABS_MODEL_ID || "eleven_v3";
}

function getElevenLabsOutputFormat(env: Env): string {
  return env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128";
}

function getElevenLabsLanguageCode(env: Env): string | undefined {
  return env.ELEVENLABS_LANGUAGE_CODE?.trim() || undefined;
}

function detectElevenLabsLanguage(text: string): ElevenLabsLanguage {
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return "zh";
}

function resolveElevenLabsVoice(env: Env, input: SpeakInput): ElevenLabsVoiceSelection {
  const language = detectElevenLabsLanguage(input.text);
  const voiceId = language === "zh"
    ? env.ELEVENLABS_VOICE_ID_ZH || env.ELEVENLABS_VOICE_ID
    : env.ELEVENLABS_VOICE_ID_EN || env.ELEVENLABS_VOICE_ID;
  const languageCode = language === "zh"
    ? env.ELEVENLABS_LANGUAGE_CODE_ZH || (env.ELEVENLABS_VOICE_ID_ZH ? "zh" : getElevenLabsLanguageCode(env))
    : env.ELEVENLABS_LANGUAGE_CODE_EN || (env.ELEVENLABS_VOICE_ID_EN ? "en" : getElevenLabsLanguageCode(env));

  return { voiceId, language, languageCode };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function getElevenLabsVoiceSettings(env: Env): Record<string, number | boolean> {
  const settings: Record<string, number | boolean> = {};
  const stability = parseOptionalNumber(env.ELEVENLABS_STABILITY);
  const similarityBoost = parseOptionalNumber(env.ELEVENLABS_SIMILARITY_BOOST);
  const style = parseOptionalNumber(env.ELEVENLABS_STYLE);
  const useSpeakerBoost = parseOptionalBoolean(env.ELEVENLABS_USE_SPEAKER_BOOST);
  const speed = parseOptionalNumber(env.ELEVENLABS_SPEED);

  if (stability !== undefined) settings.stability = stability;
  if (similarityBoost !== undefined) settings.similarity_boost = similarityBoost;
  if (style !== undefined) settings.style = style;
  if (useSpeakerBoost !== undefined) settings.use_speaker_boost = useSpeakerBoost;
  if (speed !== undefined) settings.speed = speed;

  return settings;
}

function stripAudioTags(text: string): string {
  return text
    .replace(/\[[A-Za-z][A-Za-z _-]*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?，。！？])/g, "$1")
    .trim();
}

interface VisibleCaptionChar {
  value: string;
  visibleIndex: number;
}

interface CaptionRange {
  text: string;
  start: number;
  end: number;
}

function trimCaptionPieces(pieces: VisibleCaptionChar[]): VisibleCaptionChar[] {
  let first = 0;
  let last = pieces.length - 1;

  while (first <= last && pieces[first].value.trim() === "") first++;
  while (last >= first && pieces[last].value.trim() === "") last--;

  return first <= last ? pieces.slice(first, last + 1) : [];
}

function makeCaptionRange(pieces: VisibleCaptionChar[]): CaptionRange | null {
  const trimmed = trimCaptionPieces(pieces);
  if (!trimmed.length) return null;

  const text = trimmed
    .map((piece) => piece.value)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:，。！？；：])/g, "$1")
    .trim();

  if (!text) return null;

  return {
    text,
    start: trimmed[0].visibleIndex,
    end: trimmed[trimmed.length - 1].visibleIndex + 1,
  };
}

function splitCaptionPieces(pieces: VisibleCaptionChar[]): VisibleCaptionChar[][] {
  const trimmed = trimCaptionPieces(pieces);
  if (trimmed.length <= 48) return trimmed.length ? [trimmed] : [];

  const sentenceSegments: VisibleCaptionChar[][] = [];
  let sentenceStart = 0;

  for (let i = 0; i < trimmed.length; i++) {
    if (/[.!?。！？]/.test(trimmed[i].value) && i - sentenceStart >= 8) {
      const segment = trimCaptionPieces(trimmed.slice(sentenceStart, i + 1));
      if (segment.length) sentenceSegments.push(segment);
      sentenceStart = i + 1;
    }
  }

  if (sentenceStart < trimmed.length) {
    const segment = trimCaptionPieces(trimmed.slice(sentenceStart));
    if (segment.length) sentenceSegments.push(segment);
  }

  if (sentenceSegments.length > 1) return sentenceSegments;

  const chunks: VisibleCaptionChar[][] = [];
  let chunkStart = 0;

  while (chunkStart < trimmed.length) {
    let chunkEnd = Math.min(chunkStart + 48, trimmed.length);

    if (chunkEnd < trimmed.length) {
      for (let i = chunkEnd; i > chunkStart + 18; i--) {
        if (trimmed[i]?.value.trim() === "") {
          chunkEnd = i;
          break;
        }
      }
    }

    const chunk = trimCaptionPieces(trimmed.slice(chunkStart, chunkEnd));
    if (chunk.length) chunks.push(chunk);
    chunkStart = Math.max(chunkEnd, chunkStart + 1);
  }

  return chunks;
}

function createVisibleCaptionRanges(text: string): CaptionRange[] {
  const chars = Array.from(text);
  const ranges: CaptionRange[] = [];
  let line: VisibleCaptionChar[] = [];
  let visibleIndex = 0;

  const pushLine = () => {
    for (const segment of splitCaptionPieces(line)) {
      const range = makeCaptionRange(segment);
      if (range) ranges.push(range);
    }
    line = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const value = chars[i];

    if (value === "[") {
      let closeIndex = -1;
      for (let j = i + 1; j < Math.min(chars.length, i + 82); j++) {
        if (chars[j] === "\n" || chars[j] === "\r") break;
        if (chars[j] === "]") {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex !== -1) {
        i = closeIndex;
        continue;
      }
    }

    if (value === "\r") continue;
    if (value === "\n") {
      pushLine();
      continue;
    }

    line.push({ value, visibleIndex });
    visibleIndex++;
  }

  pushLine();
  return ranges;
}

function createAlignmentVisibleIndexes(alignment: ElevenLabsAlignment): number[] {
  const characters = alignment.characters || [];
  const indexes: number[] = [];

  for (let i = 0; i < characters.length; i++) {
    const value = characters[i];

    if (value === "[") {
      let closeIndex = -1;
      for (let j = i + 1; j < Math.min(characters.length, i + 82); j++) {
        if (characters[j] === "\n" || characters[j] === "\r") break;
        if (characters[j] === "]") {
          closeIndex = j;
          break;
        }
      }
      if (closeIndex !== -1) {
        i = closeIndex;
        continue;
      }
    }

    if (value === "\n" || value === "\r") continue;
    indexes.push(i);
  }

  return indexes;
}

function createCaptionCues(text: string, alignment?: ElevenLabsAlignment): CaptionCue[] {
  if (!alignment) return [];

  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;

  if (!characters?.length || !starts?.length || !ends?.length) return [];

  const visibleIndexes = createAlignmentVisibleIndexes(alignment);
  const ranges = createVisibleCaptionRanges(text);
  const cues: CaptionCue[] = [];

  for (const range of ranges) {
    const lastVisibleOffset = Math.min(range.end, visibleIndexes.length) - 1;
    let firstAlignmentIndex = -1;
    let lastAlignmentIndex = -1;

    for (let offset = range.start; offset <= lastVisibleOffset; offset++) {
      const alignmentIndex = visibleIndexes[offset];
      if (
        alignmentIndex !== undefined &&
        characters[alignmentIndex]?.trim() !== "" &&
        Number.isFinite(starts[alignmentIndex]) &&
        Number.isFinite(ends[alignmentIndex])
      ) {
        firstAlignmentIndex = alignmentIndex;
        break;
      }
    }

    for (let offset = lastVisibleOffset; offset >= range.start; offset--) {
      const alignmentIndex = visibleIndexes[offset];
      if (
        alignmentIndex !== undefined &&
        characters[alignmentIndex]?.trim() !== "" &&
        Number.isFinite(starts[alignmentIndex]) &&
        Number.isFinite(ends[alignmentIndex])
      ) {
        lastAlignmentIndex = alignmentIndex;
        break;
      }
    }

    if (firstAlignmentIndex === -1 || lastAlignmentIndex === -1) continue;

    const start = Math.max(0, starts[firstAlignmentIndex]);
    const end = Math.max(start + 0.08, ends[lastAlignmentIndex]);
    cues.push({ text: range.text, start, end });
  }

  return cues;
}

function normalizeElevenLabsAlignment(value: unknown): ElevenLabsAlignment | undefined {
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const characters = record.characters || record.chars;
  const starts = record.character_start_times_seconds || record.start_times_seconds;
  const ends = record.character_end_times_seconds || record.end_times_seconds;

  if (
    Array.isArray(characters) &&
    Array.isArray(starts) &&
    Array.isArray(ends) &&
    characters.length === starts.length &&
    starts.length === ends.length
  ) {
    const startTimes = starts.map((start) => Number(start));
    const endTimes = ends.map((end) => Number(end));

    if (!startTimes.every(Number.isFinite) || !endTimes.every(Number.isFinite)) return undefined;

    return {
      characters: characters.map((character) => String(character)),
      character_start_times_seconds: startTimes,
      character_end_times_seconds: endTimes,
    };
  }

  return normalizeElevenLabsAlignment(record.alignment) || normalizeElevenLabsAlignment(record.normalized_alignment);
}

function buildDashScopeText(input: SpeakInput): string {
  return stripAudioTags(input.text);
}

function buildElevenLabsText(env: Env, input: SpeakInput): string {
  const modelId = getElevenLabsModel(env);

  if (modelId !== "eleven_v3") {
    return stripAudioTags(input.text);
  }

  if (input.raw_tags === true) {
    return input.text;
  }

  const text = stripAudioTags(input.text);
  const tag = input.style ? ELEVENLABS_V3_STYLE_TAGS[input.style.trim().toLowerCase()] : undefined;

  return tag ? `${tag} ${text}` : text;
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary);
}

async function generateDashScopeAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  try {
    const apiKey = env.DASHSCOPE_API_KEY;
    const voiceId = env.VOICE_ID;

    if (!apiKey) {
      return { success: false, error: "DASHSCOPE_API_KEY is not configured" };
    }
    if (!voiceId) {
      return { success: false, error: "VOICE_ID is not configured" };
    }

    const model = getDashScopeModel(env);
    const finalText = buildDashScopeText(input);

    const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: {
          text: finalText,
          voice: voiceId,
          format: "mp3",
          sample_rate: 24000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `DashScope API error ${response.status}: ${errorText}` };
    }

    const data = await response.json() as Record<string, unknown>;

    // Try output.audio.url first
    const output = data.output as Record<string, unknown> | undefined;
    const audio = output?.audio as Record<string, unknown> | undefined;

    if (audio?.url && typeof audio.url === "string") {
      const audioResp = await fetch(audio.url);
      if (!audioResp.ok) {
        return { success: false, error: `Failed to fetch audio: ${audioResp.status}` };
      }
      const arrayBuffer = await audioResp.arrayBuffer();
      return { success: true, audio_base64: arrayBufferToBase64(arrayBuffer) };
    }

    // Fallback: output.audio.data may already be base64
    if (audio?.data && typeof audio.data === "string") {
      return { success: true, audio_base64: audio.data };
    }

    return { success: false, error: "No audio data in response" };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function generateElevenLabsAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  try {
    const apiKey = env.ELEVENLABS_API_KEY;
    const voiceSelection = resolveElevenLabsVoice(env, input);

    if (!apiKey) {
      return { success: false, error: "ELEVENLABS_API_KEY is not configured" };
    }
    if (!voiceSelection.voiceId) {
      return { success: false, error: "ELEVENLABS_VOICE_ID is not configured" };
    }

    const modelId = getElevenLabsModel(env);
    const outputFormat = getElevenLabsOutputFormat(env);
    const finalText = buildElevenLabsText(env, input);
    const voiceSettings = getElevenLabsVoiceSettings(env);
    console.log("ElevenLabs TTS request", JSON.stringify({
      model_id: modelId,
      text: finalText,
    }));

    const requestUrl = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceSelection.voiceId)}/with-timestamps`);
    requestUrl.searchParams.set("output_format", outputFormat);
    const requestBody: Record<string, unknown> = {
      text: finalText,
      model_id: modelId,
      voice_settings: voiceSettings,
    };

    if (voiceSelection.languageCode) {
      requestBody.language_code = voiceSelection.languageCode;
    }

    const response = await fetch(requestUrl.toString(), {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `ElevenLabs API error ${response.status}: ${errorText}` };
    }

    const data = await response.json() as {
      audio_base64?: string;
      alignment?: ElevenLabsAlignment;
      normalized_alignment?: ElevenLabsAlignment;
    };

    if (!data.audio_base64) {
      return { success: false, error: "No audio data in response" };
    }

    return {
      success: true,
      audio_base64: data.audio_base64,
      alignment: data.alignment,
      normalized_alignment: data.normalized_alignment,
      final_text: finalText,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function isValidHistoryItemId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,96}$/.test(value);
}

function getTextFromHistoryDialogue(dialogue: ElevenLabsHistoryItem["dialogue"]): string | undefined {
  if (!Array.isArray(dialogue)) return undefined;

  const text = dialogue
    .map((entry) => typeof entry.text === "string" ? entry.text.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text || undefined;
}

function getTextFromAlignment(alignment?: ElevenLabsAlignment): string | undefined {
  const text = alignment?.characters?.join("").trim();
  return text || undefined;
}

function getHistoryText(metadata: ElevenLabsHistoryItem, alignment: ElevenLabsAlignment | undefined, historyItemId: string): string {
  return metadata.text?.trim()
    || getTextFromHistoryDialogue(metadata.dialogue)
    || getTextFromAlignment(alignment)
    || `ElevenLabs history ${historyItemId}`;
}

function hasUsableCaptionCues(text: string, cues: CaptionCue[]): boolean {
  if (!cues.length) return false;

  const visibleLength = stripAudioTags(text).length;
  const lastEnd = Math.max(...cues.map((cue) => cue.end));
  const hasSubstantialCue = cues.some((cue) => cue.end - cue.start > 0.35);

  if (visibleLength > 60 && lastEnd < 3) return false;
  return hasSubstantialCue || visibleLength <= 20;
}

async function createForcedAlignment(env: Env, text: string, audioBuffer: ArrayBuffer): Promise<ElevenLabsAlignment | undefined> {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey || !text.trim()) return undefined;

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "history.mp3");
  formData.append("text", text);

  const response = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    console.error("ElevenLabs forced alignment failed", response.status, await response.text());
    return undefined;
  }

  const data = await response.json() as {
    characters?: Array<{ text?: string; start?: number; end?: number }>;
  };

  if (!Array.isArray(data.characters) || !data.characters.length) return undefined;

  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  for (const character of data.characters) {
    const value = character.text || "";
    const start = Number(character.start);
    const end = Number(character.end);

    if (!value || !Number.isFinite(start) || !Number.isFinite(end)) continue;

    characters.push(value);
    starts.push(start);
    ends.push(end);
  }

  if (!characters.length || characters.length !== starts.length || starts.length !== ends.length) return undefined;

  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

async function fetchElevenLabsHistoryEvent(env: Env, historyItemId: string): Promise<{ success: boolean; event?: VoiceEvent; error?: string }> {
  try {
    const apiKey = env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      return { success: false, error: "ELEVENLABS_API_KEY is not configured" };
    }
    if (!isValidHistoryItemId(historyItemId)) {
      return { success: false, error: "Invalid ElevenLabs history item ID" };
    }

    const historyUrl = `https://api.elevenlabs.io/v1/history/${encodeURIComponent(historyItemId)}`;
    const metadataResponse = await fetch(historyUrl, {
      headers: {
        "xi-api-key": apiKey,
        "Accept": "application/json",
      },
    });

    if (!metadataResponse.ok) {
      const errorText = await metadataResponse.text();
      return { success: false, error: `ElevenLabs history error ${metadataResponse.status}: ${errorText}` };
    }

    const metadata = await metadataResponse.json() as ElevenLabsHistoryItem;
    const audioResponse = await fetch(`${historyUrl}/audio`, {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!audioResponse.ok) {
      const errorText = await audioResponse.text();
      return { success: false, error: `ElevenLabs history audio error ${audioResponse.status}: ${errorText}` };
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBase64 = arrayBufferToBase64(audioBuffer);
    const alignment = normalizeElevenLabsAlignment(metadata.alignments);
    const text = getHistoryText(metadata, alignment, historyItemId);
    let captionCues = createCaptionCues(text, alignment);

    if (!hasUsableCaptionCues(text, captionCues)) {
      const forcedText = stripAudioTags(text) || text;
      const forcedAlignment = await createForcedAlignment(env, forcedText, audioBuffer);
      captionCues = forcedAlignment ? createCaptionCues(forcedText, forcedAlignment) : [];
    }

    const createdAt = typeof metadata.date_unix === "number" && Number.isFinite(metadata.date_unix)
      ? new Date(metadata.date_unix * 1000).toISOString()
      : new Date().toISOString();

    return {
      success: true,
      event: {
        id: crypto.randomUUID(),
        text,
        audio_base64: audioBase64,
        created_at: createdAt,
        provider: "elevenlabs",
        model_id: metadata.model_id || getElevenLabsModel(env),
        history_item_id: metadata.history_item_id || historyItemId,
        caption_cues: captionCues.length ? captionCues : undefined,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function generateAudio(env: Env, input: SpeakInput): Promise<AudioResult> {
  return getTtsProvider(env) === "elevenlabs"
    ? generateElevenLabsAudio(env, input)
    : generateDashScopeAudio(env, input);
}

function getTtsStatus(env: Env): Record<string, unknown> {
  const provider = getTtsProvider(env);

  if (provider === "elevenlabs") {
    const modelId = getElevenLabsModel(env);
    return {
      provider,
      model_id: modelId,
      model: modelId,
      voice_id: env.ELEVENLABS_VOICE_ID || "",
      voice_id_zh: env.ELEVENLABS_VOICE_ID_ZH || "",
      voice_id_en: env.ELEVENLABS_VOICE_ID_EN || "",
      configured: Boolean(env.ELEVENLABS_API_KEY && (env.ELEVENLABS_VOICE_ID || env.ELEVENLABS_VOICE_ID_ZH || env.ELEVENLABS_VOICE_ID_EN)),
      configured_zh: Boolean(env.ELEVENLABS_API_KEY && (env.ELEVENLABS_VOICE_ID_ZH || env.ELEVENLABS_VOICE_ID)),
      configured_en: Boolean(env.ELEVENLABS_API_KEY && (env.ELEVENLABS_VOICE_ID_EN || env.ELEVENLABS_VOICE_ID)),
      audio_tags_enabled: modelId === "eleven_v3",
      language_mode: env.ELEVENLABS_VOICE_ID_ZH || env.ELEVENLABS_VOICE_ID_EN ? "auto" : "single",
      language_code: getElevenLabsLanguageCode(env) || "",
      language_codes: {
        zh: env.ELEVENLABS_LANGUAGE_CODE_ZH || (env.ELEVENLABS_VOICE_ID_ZH ? "zh" : ""),
        en: env.ELEVENLABS_LANGUAGE_CODE_EN || (env.ELEVENLABS_VOICE_ID_EN ? "en" : ""),
      },
      voice_settings: getElevenLabsVoiceSettings(env),
    };
  }

  const modelId = getDashScopeModel(env);
  return {
    provider,
    model_id: modelId,
    model: modelId,
    voice_id: env.VOICE_ID ? "configured" : "not configured",
    configured: Boolean(env.DASHSCOPE_API_KEY && env.VOICE_ID),
    audio_tags_enabled: false,
  };
}

function parseRawTags(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value.trim().toLowerCase() === "true";
}

function getSpeakInputError(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return "Missing text parameter";

  if (/\{text\}/i.test(trimmed)) {
    return "Text placeholder was not replaced";
  }

  const visibleText = stripAudioTags(trimmed);
  if (!/[A-Za-z0-9\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(visibleText)) {
    return "No speakable text";
  }

  return undefined;
}

function getLatestVoiceCacheRequest(origin: string): Request {
  return new Request(new URL(LATEST_VOICE_CACHE_PATH, origin).toString(), { method: "GET" });
}

function createVoiceEvent(env: Env, input: SpeakInput, result: AudioResult): VoiceEvent {
  const provider = getTtsProvider(env);
  const finalText = result.final_text || input.text;
  const alignment = result.alignment || result.normalized_alignment;
  const captionCues = createCaptionCues(finalText, alignment);

  return {
    id: crypto.randomUUID(),
    text: input.text,
    audio_base64: result.audio_base64 || "",
    created_at: new Date().toISOString(),
    provider,
    model_id: provider === "elevenlabs" ? getElevenLabsModel(env) : getDashScopeModel(env),
    caption_cues: captionCues.length ? captionCues : undefined,
    style: input.style,
    raw_tags: input.raw_tags,
  };
}

async function storeLatestVoiceEvent(origin: string, event: VoiceEvent): Promise<void> {
  await caches.default.put(
    getLatestVoiceCacheRequest(origin),
    Response.json(event, {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    }),
  );
}

async function readLatestVoiceEvent(origin: string): Promise<VoiceEvent | null> {
  const response = await caches.default.match(getLatestVoiceCacheRequest(origin));
  if (!response) return null;
  return await response.json<VoiceEvent>();
}

// =============================================================================
// MCP Server Factory
// =============================================================================

function createVoiceServer(env: Env, origin: string): McpServer {
  const botName = env.BOT_NAME || 'AI';
  const PLAYER_HTML = getPlayerHTML(botName);

  const server = new McpServer({
    name: "voice-mcp",
    version: "1.0.0",
  });

  const uiCapabilities = {
    extensions: {
      "io.modelcontextprotocol/ui": {},
    },
  } as unknown as Parameters<typeof server.server.registerCapabilities>[0];
  server.server.registerCapabilities(uiCapabilities);

  server.resource(
    VOICE_RESOURCE_URI,
    VOICE_RESOURCE_URI,
    { mimeType: EXT_APPS_MIME, description: "Voice Player" },
    async () => ({
      contents: [
        {
          uri: VOICE_RESOURCE_URI,
          mimeType: EXT_APPS_MIME,
          text: PLAYER_HTML,
        },
      ],
    }),
  );

  server.registerTool(
    "speak",
    {
      title: `${botName}'s Voice`,
      description: `Make ${botName} speak with a custom cloned voice. The audio will play in an inline player.`,
      inputSchema: z.object({
        text: z.string().describe("Text to speak"),
        style: z.string().optional().describe("Optional speaking style"),
        raw_tags: z.boolean().optional().describe("Allow raw ElevenLabs v3 audio tags when supported"),
      }),
      _meta: {
        ui: { resourceUri: VOICE_RESOURCE_URI },
        "ui/resourceUri": VOICE_RESOURCE_URI,
      },
    },
    async ({ text, style, raw_tags }) => {
      const input = { text, style, raw_tags };
      const inputError = getSpeakInputError(input.text);
      if (inputError) {
        return {
          content: [
            { type: "text" as const, text: `Voice generation skipped: ${inputError}` },
          ],
          structuredContent: {
            error: inputError,
          },
        };
      }

      const result = await generateAudio(env, input);

      if (result.success && result.audio_base64) {
        try {
          await storeLatestVoiceEvent(origin, createVoiceEvent(env, input, result));
        } catch (error) {
          console.error("Failed to store latest voice event", error);
        }

        return {
          content: [
            { type: "text" as const, text: `🎙️ ${botName} says: "${text}"` },
          ],
          structuredContent: {
            text: text,
            audio_base64: result.audio_base64,
          },
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Voice generation failed: ${result.error}` },
        ],
        structuredContent: {
          error: result.error || 'Unknown error',
        },
      };
    },
  );

  return server;
}

// =============================================================================
// Worker Handler
// =============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // MCP Endpoint
    if (path === '/mcp' || path === '/mcp/' || path === '/sse') {
      const server = createVoiceServer(env, url.origin);
      const handler = createMcpHandler(server, {
        route: null as unknown as string,
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      return handler(request, env, ctx);
    }

    if (path === '/panel') {
      const botName = env.BOT_NAME || 'Haven';
      return new Response(getVisualizerPanelHTML(botName), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          "Cache-Control": "no-store",
        },
      });
    }

    if (path === '/events/latest') {
      const event = await readLatestVoiceEvent(url.origin);
      if (!event || event.id === url.searchParams.get('since')) {
        return Response.json({ event: null }, {
          headers: {
            ...corsHeaders,
            "Cache-Control": "no-store",
          },
        });
      }
      return Response.json({ event }, {
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      });
    }

    if (path === '/history' && request.method === 'GET') {
      const historyItemId = url.searchParams.get('id')?.trim();

      if (!historyItemId) {
        return Response.json({ error: 'Missing id parameter' }, {
          status: 400,
          headers: corsHeaders,
        });
      }

      const result = await fetchElevenLabsHistoryEvent(env, historyItemId);
      if (!result.success || !result.event) {
        return Response.json({ error: result.error || 'History item unavailable' }, {
          status: 500,
          headers: corsHeaders,
        });
      }

      try {
        await storeLatestVoiceEvent(url.origin, result.event);
      } catch (error) {
        console.error("Failed to store latest voice event", error);
      }

      return Response.json({ event: result.event }, {
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      });
    }

    // Status check
    if (path === '/status') {
      return Response.json({
        status: 'ok',
        service: 'voice-mcp',
        ...getTtsStatus(env),
        version: '1.0.0',
      }, { headers: corsHeaders });
    }

    // Direct audio API
    if (path === '/speak' && request.method === 'GET') {
      const text = url.searchParams.get('text');
      const textValue = text || "";
      const inputError = getSpeakInputError(textValue);
      if (inputError) {
        return Response.json({ error: inputError }, {
          status: 400,
          headers: corsHeaders
        });
      }

      const input = {
        text: textValue,
        style: url.searchParams.get('style') || undefined,
        raw_tags: parseRawTags(url.searchParams.get('raw_tags')),
      };
      const result = await generateAudio(env, input);

      if (result.success && result.audio_base64) {
        try {
          await storeLatestVoiceEvent(url.origin, createVoiceEvent(env, input, result));
        } catch (error) {
          console.error("Failed to store latest voice event", error);
        }

        const binaryString = atob(result.audio_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        return new Response(bytes, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': 'inline; filename="voice.mp3"',
          },
        });
      }

      return Response.json({ error: result.error }, {
        status: 500,
        headers: corsHeaders
      });
    }

    // Landing page
    if (path === '/' || path === '') {
      const botName = env.BOT_NAME || 'AI';
      return new Response(
        `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>voice-mcp</title>
<style>
  body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; color: #333; line-height: 1.6; }
  h1 { color: #07c160; }
  code { background: #f5f5f5; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
  .section { margin: 24px 0; }
  .endpoint { margin: 8px 0; }
  a { color: #07c160; }
</style>
</head><body>
<h1>🎙️ voice-mcp</h1>
<p>An MCP server for AI voice synthesis with inline audio player.</p>

<div class="section">
<h3>MCP Server</h3>
<p>Add this URL to your Claude.ai Connectors:</p>
<code>${url.origin}/mcp</code>
</div>

<div class="section">
<h3>Direct API</h3>
<div class="endpoint">
  <code>GET /panel</code> — Breathing voice visualizer
</div>
<div class="endpoint">
  <code>GET /history?id=...</code> — Load an ElevenLabs history item into the visualizer
</div>
<div class="endpoint">
  <code>GET /speak?text=Hello</code> — Get audio file directly
</div>
<div class="endpoint">
  <code>GET /status</code> — Health check
</div>
</div>

<div class="section">
<h3>Configuration</h3>
<p>Bot name: <strong>${botName}</strong></p>
</div>

<p style="margin-top: 32px; color: #666; font-size: 14px;">
  <a href="https://github.com/xxx/voice-mcp">GitHub</a> · MIT License
</p>
</body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};
