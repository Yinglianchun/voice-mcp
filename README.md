# voice-mcp

An MCP (Model Context Protocol) server for AI voice synthesis with an inline audio player. Give your AI assistant a custom cloned voice!

![License](https://img.shields.io/badge/license-MIT-green)

## Fork Notice

This repository is a fork of [garan0613/voice-mcp](https://github.com/garan0613/voice-mcp), released under the MIT License.

This fork lives at [Yinglianchun/voice-mcp](https://github.com/Yinglianchun/voice-mcp) and keeps the original MCP `speak(text)` behavior while adding provider switching, ElevenLabs support, and a live visualizer panel.

## What Changed in This Fork

- Added `TTS_PROVIDER` switching between DashScope/CosyVoice and ElevenLabs.
- Kept the old `speak(text)` call compatible, and extended it to `speak(text, style?, raw_tags?)`.
- Added ElevenLabs TTS support with configurable model, output format, voice settings, and optional v3 audio tags.
- Added style-to-tag mapping for ElevenLabs v3, while stripping raw audio tags before DashScope/CosyVoice calls.
- Added `/status` fields for provider, model, voice, configuration state, and audio tag availability.
- Added `/panel`, a breathing audio visualizer that listens for the latest MCP `speak` result.
- Added `/events/latest` so the panel can receive the newest generated voice and text.
- Added ElevenLabs history loading through `/history?id=...`.
- Added line-style captions, playback-linked caption timing when ElevenLabs timing data is available, and MP3 download from the panel.

## Features

- **Custom Voice Cloning** — Use DashScope Qwen-TTS Voice Cloning API or ElevenLabs TTS with your own cloned voice
- **Inline Audio Player** — Beautiful WeChat-style player with waveform visualization
- **Breathing Visualizer Panel** — Use `/panel` to listen for the latest MCP `speak` output
- **Transcript Toggle** — Show/hide the spoken text
- **Dark Mode Support** — Automatic theme adaptation
- **Cloudflare Workers** — Fast, serverless deployment

## Demo

When you call the `speak` tool, you get:
- A sleek audio player with play/pause button
- Animated waveform that follows playback progress
- Duration display
- Expandable transcript

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/Yinglianchun/voice-mcp.git
cd voice-mcp
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure TTS provider

Set the provider. If omitted, the worker uses DashScope.

```bash
npx wrangler secret put TTS_PROVIDER  # dashscope or elevenlabs
```

#### DashScope / CosyVoice

You'll need an Alibaba Cloud DashScope account with Qwen-TTS Voice Cloning access.

Add your secrets to Cloudflare:

```bash
npx wrangler secret put DASHSCOPE_API_KEY
npx wrangler secret put VOICE_ID
npx wrangler secret put BOT_NAME  # Optional, defaults to "AI"
```

Optional:

```bash
npx wrangler secret put TTS_MODEL  # Default: qwen3-tts-vc-2026-01-22
```

#### ElevenLabs

Add your ElevenLabs secrets to Cloudflare:

```bash
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_VOICE_ID
npx wrangler secret put ELEVENLABS_VOICE_ID_ZH
npx wrangler secret put ELEVENLABS_VOICE_ID_EN
```

Optional:

```bash
npx wrangler secret put ELEVENLABS_MODEL_ID       # Default: eleven_v3
npx wrangler secret put ELEVENLABS_OUTPUT_FORMAT  # Default: mp3_44100_128
npx wrangler secret put ELEVENLABS_LANGUAGE_CODE  # Example: zh
npx wrangler secret put ELEVENLABS_LANGUAGE_CODE_ZH  # Default with zh voice: zh
npx wrangler secret put ELEVENLABS_LANGUAGE_CODE_EN  # Default with en voice: en
npx wrangler secret put ELEVENLABS_STABILITY      # Example: 0.36
npx wrangler secret put ELEVENLABS_STYLE          # Example: 0.85
npx wrangler secret put ELEVENLABS_SPEED          # Example: 1.20
```

`eleven_v3` supports audio tags such as `[whispers]`, `[sighs]`, and `[laughs]`.
`eleven_multilingual_v2` is a steadier choice for ordinary reading.

### 4. Deploy

```bash
npx wrangler deploy
```

### 5. Connect to Claude.ai

1. Go to **Settings -> Connectors -> Add Connector**
2. Enter your Worker URL: `https://your-worker.workers.dev/mcp`
3. Done! The `speak` tool is now available.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TTS_PROVIDER` | No | `dashscope` or `elevenlabs`; defaults to `dashscope` |
| `DASHSCOPE_API_KEY` | DashScope | Your DashScope API key |
| `VOICE_ID` | DashScope | The cloned voice ID (Qwen-TTS VC) |
| `BOT_NAME` | No | Display name (default: "AI") |
| `TTS_MODEL` | No | DashScope TTS model (default: `cosyvoice-v3.5-plus`) |
| `ELEVENLABS_API_KEY` | ElevenLabs | Your ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | ElevenLabs | Default/fallback ElevenLabs voice ID |
| `ELEVENLABS_VOICE_ID_ZH` | No | Chinese ElevenLabs voice ID; auto-selected when text contains Chinese |
| `ELEVENLABS_VOICE_ID_EN` | No | English ElevenLabs voice ID; auto-selected for English text |
| `ELEVENLABS_MODEL_ID` | No | ElevenLabs model (default: `eleven_v3`) |
| `ELEVENLABS_OUTPUT_FORMAT` | No | ElevenLabs output format (default: `mp3_44100_128`) |
| `ELEVENLABS_LANGUAGE_CODE` | No | ElevenLabs request language code, such as `zh` |
| `ELEVENLABS_LANGUAGE_CODE_ZH` | No | Chinese request language code; defaults to `zh` when `ELEVENLABS_VOICE_ID_ZH` is set |
| `ELEVENLABS_LANGUAGE_CODE_EN` | No | English request language code; defaults to `en` when `ELEVENLABS_VOICE_ID_EN` is set |
| `ELEVENLABS_STABILITY` | No | ElevenLabs voice setting override, such as `0.36` |
| `ELEVENLABS_SIMILARITY_BOOST` | No | ElevenLabs voice setting override |
| `ELEVENLABS_STYLE` | No | ElevenLabs voice setting override, such as `0.85` |
| `ELEVENLABS_USE_SPEAKER_BOOST` | No | ElevenLabs voice setting override, `true` or `false` |
| `ELEVENLABS_SPEED` | No | ElevenLabs voice setting override, such as `1.20` |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /mcp` | MCP server (SSE protocol) |
| `GET /panel` | Breathing voice visualizer that listens for MCP `speak` |
| `GET /events/latest` | Latest generated voice event for the visualizer |
| `GET /history?id=...` | Load an ElevenLabs history item into the visualizer |
| `GET /speak?text=Hello` | Direct audio file |
| `GET /speak?text=Hello&style=soft` | Direct audio file with optional style |
| `GET /speak?text=[whispers]%20Hello&raw_tags=true` | Preserve ElevenLabs v3 audio tags |
| `GET /status` | Health check |

The MCP `speak` tool accepts:

```ts
speak(text: string, style?: string, raw_tags?: boolean)
```

Existing `speak(text)` calls remain compatible.

When the MCP `speak` tool succeeds, the Worker stores the latest voice event for
`/panel`. Keep `/panel` open while using `speak`; when a new voice arrives, the
visualizer loads it and enables playback.
ElevenLabs uses the speech-with-timing API to store line-level caption cues for
sync; providers without timing data fall back to approximate caption progress.

When `TTS_PROVIDER=elevenlabs` and `ELEVENLABS_MODEL_ID=eleven_v3`, `raw_tags=true`
passes text through unchanged. Without `raw_tags=true`, supported styles map to
ElevenLabs v3 audio tags:

| Style | Audio tag |
|-------|-----------|
| `soft` | `[whispers]` |
| `teasing` | `[mischievously]` |
| `excited` | `[excited]` |
| `tired` | `[sighs]` |
| `laughing` | `[laughs]` |
| `curious` | `[curious]` |

DashScope/CosyVoice and non-v3 ElevenLabs calls strip raw audio tags before sending text to the provider.

## Tech Stack

- [Cloudflare Workers](https://workers.cloudflare.com/) — Serverless runtime
- [MCP SDK](https://github.com/modelcontextprotocol/sdk) — Model Context Protocol
- [DashScope Qwen-TTS VC](https://dashscope.aliyun.com/) — Voice synthesis
- [ElevenLabs Text to Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) — Voice synthesis
- [ext-apps](https://modelcontextprotocol.io/docs/concepts/ext-apps) — Inline UI rendering

## License

MIT. This fork preserves the upstream license from [garan0613/voice-mcp](https://github.com/garan0613/voice-mcp).
