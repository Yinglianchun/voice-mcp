import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Miniflare } from "miniflare";

const storage = await mkdtemp(join(tmpdir(), "voice-cache-"));
execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--outdir", join(storage, "bundle")], { stdio: "pipe" });
let calls = 0;
let mixCalls = 0;
let fail = false;
let lastTtsText = "";
let mf;
const bindings = {
  TTS_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "test-key",
  ELEVENLABS_VOICE_ID: "test-voice", ELEVENLABS_MODEL_ID: "eleven_v4",
  VOICE_SFX_URL: "https://mixer.test/mix", VOICE_SFX_TOKEN: "test-mixer-token",
};
const audio = Buffer.alloc(160000, 7).toString("base64");
const mixedAudio = Buffer.alloc(170000, 9);
const options = {
  modules: true, scriptPath: join(storage, "bundle", "index.js"),
  compatibilityDate: "2025-04-01", compatibilityFlags: ["nodejs_compat"],
  durableObjects: { VOICE_AUDIO_CACHE: { className: "VoiceAudioCache", useSQLite: true } },
  durableObjectsPersist: storage, bindings,
  outboundService: async (request) => {
    if (request.url === bindings.VOICE_SFX_URL) {
      mixCalls++;
      assert.equal(request.headers.get("Authorization"), "Bearer test-mixer-token");
      const form = await request.formData();
      assert.equal(form.get("tag"), "[low, close | sfx=low]");
      assert.ok(form.get("voice") instanceof File);
      return new Response(mixedAudio, { headers: { "Content-Type": "audio/mpeg" } });
    }
    assert.match(request.url, /^https:\/\/api.elevenlabs.io\/v1\/text-to-speech\//);
    calls++;
    lastTtsText = (await request.clone().json()).text;
    await new Promise(resolve => setTimeout(resolve, 30));
    return fail ? new Response("upstream failed", { status: 500 })
      : Response.json({ audio_base64: audio });
  },
};
const get = (text, extra = "", endpoint = "speak") => mf.dispatchFetch(
  `https://voice.test/${endpoint}?text=${encodeURIComponent(text)}${extra}`,
);
try {
  mf = new Miniflare(options);
  const first = await get("Cache me.");
  assert.equal(first.headers.get("X-Voice-Cache"), "MISS");
  assert.equal((await first.arrayBuffer()).byteLength, 160000);
  const second = await get("Cache me.", "", "speak-cached");
  assert.equal(second.headers.get("X-Voice-Cache"), "HIT");
  await second.arrayBuffer();
  assert.equal(calls, 1);

  const concurrent = await Promise.all(Array.from({ length: 6 }, () => mf.dispatchFetch(
    "https://voice.test/speak", { method: "POST", body: JSON.stringify({ text: "Concurrent." }) },
  )));
  for (const response of concurrent) {
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, 160000);
  }
  assert.equal(calls, 2, "concurrent cold requests generate once");
  assert.ok(concurrent.some(r => r.headers.get("X-Voice-Cache") === "COALESCED"));

  await mf.dispose();
  mf = new Miniflare(options);
  const persisted = await mf.dispatchFetch("https://voice.test/speak", {
    method: "POST", body: JSON.stringify({ text: "Cache me." }),
  });
  assert.equal(persisted.headers.get("X-Voice-Cache"), "HIT");
  assert.equal((await persisted.arrayBuffer()).byteLength, 160000);
  assert.equal(calls, 2, "restart with empty edge cache reuses persistent audio");

  for (const extra of ["&style=soft", "&raw_tags=true"]) {
    const changed = await get("Cache me.", extra);
    await changed.arrayBuffer();
  }
  assert.equal(calls, 4, "style and raw tag changes use distinct recipes");

  const mixed = await get("[low, close | sfx=low] Stay still.");
  assert.equal(mixed.status, 200);
  assert.equal((await mixed.arrayBuffer()).byteLength, mixedAudio.byteLength);
  assert.equal(lastTtsText, "[low, close] Stay still.", "post-processing syntax is not spoken");
  assert.equal(mixCalls, 1);
  const mixedAgain = await get("[low, close | sfx=low] Stay still.");
  await mixedAgain.arrayBuffer();
  assert.equal(mixedAgain.headers.get("X-Voice-Cache"), "HIT");
  assert.equal(mixCalls, 1, "mixed result is cached");
  assert.equal((await get("[low | sfx=unknown] Nope.")).status, 400);
  assert.equal(calls, 5, "invalid sfx directives never synthesize");

  fail = true;
  assert.equal((await get("Retry failure.")).status, 500);
  fail = false;
  assert.equal((await get("Retry failure.")).status, 200);
  assert.equal(calls, 7, "failed synthesis is not cached");
  assert.equal((await get("")).status, 400);
  assert.equal(calls, 7, "invalid input never synthesizes");

  await mf.dispose();
  mf = new Miniflare({ ...options, bindings: { ...bindings, ELEVENLABS_VOICE_ID: "other-voice" } });
  assert.equal((await get("Cache me.")).headers.get("X-Voice-Cache"), "MISS");
  assert.equal(calls, 8, "voice change invalidates cached audio");
  await mf.dispose();
  mf = new Miniflare({ ...options, bindings: { ...bindings, ELEVENLABS_MODEL_ID: "eleven_v4_turbo" } });
  assert.equal((await get("Cache me.")).headers.get("X-Voice-Cache"), "MISS");
  assert.equal(calls, 9, "model change invalidates cached audio");
  await mf.dispose();
  mf = new Miniflare({ ...options, durableObjects: {} });
  assert.equal((await get("Storage unavailable.")).status, 503);
  assert.equal(calls, 9, "missing storage must not fall back to paid TTS");
  console.log("Audio cache integration checks passed (mocked TTS; no credits used).");
} finally {
  await mf?.dispose();
  await rm(storage, { recursive: true, force: true });
}
