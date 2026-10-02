// Cuecard: a teleprompter that paces the script to your time budget and warns you when a section runs long.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStored } from "./lib/store";
import { Section, Stat, Stats } from "./ui/kit";

const T = "cuecard";
const SAMPLE = `# Hook (0:20)
Most people price handmade work by guessing. Today I will show you the three-number formula I use, and why it stopped me from losing money on every order.

# The formula (1:30)
Start with materials. Add up everything that goes into one piece, including the packaging.
Multiply that by three. That covers waste, tools and the pieces that crack.
Then add your hourly rate multiplied by the hours the piece really takes, not the hours you wish it took.

# Example (1:00)
A mug uses four dinars of clay and glaze. Times three is twelve. It takes one and a half hours at twenty dinars an hour, which is thirty. So the floor price is forty-two dinars.

# Close (0:30)
Write your floor price on a sticky note and never go below it. If you want the spreadsheet, the link is in the description.`;

type Sec = { title: string; budget: number; text: string; words: number; startWord: number };
const toSec = (s: string) => { const [m, x] = s.split(":").map(Number); return m * 60 + (x || 0); };
const mmss = (s: number) => `${s < 0 ? "-" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, "0")}`;

function parse(script: string): Sec[] {
  const out: Sec[] = []; let cur: Sec | null = null; let wordsSoFar = 0;
  for (const line of script.split("\n")) {
    const h = line.match(/^#\s*(.+?)\s*(?:\((\d+:\d{2})\))?\s*$/);
    if (h) { cur = { title: h[1], budget: h[2] ? toSec(h[2]) : 0, text: "", words: 0, startWord: wordsSoFar }; out.push(cur); continue; }
    if (!cur) { cur = { title: "Script", budget: 0, text: "", words: 0, startWord: 0 }; out.push(cur); }
    cur.text += line + "\n";
    const w = line.split(/\s+/).filter(Boolean).length; cur.words += w; wordsSoFar += w;
  }
  return out;
}

type SR = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null };

export default function Cuecard() {
  const [script, setScript] = useStored(T, "script", SAMPLE);
  const [wpm, setWpm] = useStored(T, "wpm", 150);
  const [size, setSize] = useStored(T, "size", 44);
  const [mirror, setMirror] = useStored(T, "mirror", false);
  const [lang, setLang] = useStored(T, "lang", "en-US");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const [pos, setPos] = useState(0); // index of the word being read
  const [voice, setVoice] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const recog = useRef<SR | null>(null);
  const secs = useMemo(() => parse(script), [script]);
  const words = useMemo(() => script.split("\n").filter(l => !l.startsWith("#")).join(" ").split(/\s+/).filter(Boolean), [script]);
  const totalWords = words.length;
  const budget = secs.reduce((a, s) => a + s.budget, 0);
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const SRClass = w.SpeechRecognition ?? w.webkitSpeechRecognition;

  useEffect(() => {
    if (!running) return;
    const t0 = performance.now() - elapsedRef.current * 1000;
    const id = setInterval(() => {
      const e = (performance.now() - t0) / 1000;
      elapsedRef.current = e; setElapsed(e);
      if (!voice) setPos(Math.min(totalWords, Math.floor((e / 60) * wpm)));
    }, 100);
    return () => clearInterval(id);
  }, [running, wpm, voice, totalWords]);

  useEffect(() => {
    const el = stage.current?.querySelector<HTMLElement>(`[data-w="${pos}"]`);
    if (el && stage.current) stage.current.scrollTo({ top: el.offsetTop - stage.current.clientHeight * 0.3, behavior: "smooth" });
  }, [pos]);

  const restart = () => { setRunning(false); elapsedRef.current = 0; setElapsed(0); setPos(0); };
  const toggleVoice = () => {
    if (voice) { const r = recog.current; recog.current = null; r?.stop(); setVoice(false); return; }
    if (!SRClass) return;
    const r = new SRClass(); r.continuous = true; r.interimResults = true; r.lang = lang;
    const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const scriptN = words.map(norm);
    r.onresult = e => {
      const last = e.results[e.results.length - 1][0].transcript.split(/\s+/).map(norm).filter(Boolean).slice(-3);
      if (last.length < 2) return;
      setPos(p => {
        for (let i = p; i < Math.min(scriptN.length, p + 60); i++) if (last.every((x, k) => scriptN[i + k] === x)) return i + last.length;
        return p;
      });
    };
    r.onend = () => { if (recog.current === r) r.start(); };
    recog.current = r; r.start(); setVoice(true);
  };

  const curSec = [...secs].reverse().find(s => pos >= s.startWord) ?? secs[0];
  const secIndex = secs.indexOf(curSec);
  const secStartTime = secs.slice(0, secIndex).reduce((a, s) => a + s.budget, 0);
  const secLeft = curSec ? secStartTime + curSec.budget - elapsed : 0;
  const over = budget > 0 && elapsed > budget;
  const need = (totalWords / wpm) * 60;
  let wi = 0;

  return (
    <div className="stack">
      <div className="grid2">
        <Section title="Script">
          <label className="field"><span>Start sections with # Title (m:ss) to give each a time budget</span>
            <textarea id="cc-script" className="input" rows={12} value={script} onChange={e => setScript(e.target.value)} style={{ fontSize: 14 }} />
          </label>
        </Section>
        <Section title="Timing">
          <Stats><Stat value={totalWords} label="Words" /><Stat value={mmss(need)} label="At your pace" /><Stat value={budget ? mmss(budget) : "None"} label="Budget" tone={budget && need > budget ? "bad" : undefined} /></Stats>
          {budget > 0 && need > budget && <p className="pill bad" style={{ marginTop: 10 }}>At {wpm} words a minute this runs {mmss(need - budget)} over. Cut about {Math.ceil(totalWords - (budget / 60) * wpm)} words.</p>}
          <table className="t" style={{ marginTop: 14 }}><tbody>
            {secs.map((s, i) => { const n = (s.words / wpm) * 60; return <tr key={i}><td>{s.title}</td><td className="r">{s.words} words</td><td className="r">{mmss(n)}</td><td className="r">{s.budget ? <span className={"pill " + (n > s.budget ? "bad" : "good")}>{mmss(s.budget)}</span> : ""}</td></tr>; })}
          </tbody></table>
          <div className="row" style={{ marginTop: 14 }}>
            <label className="field"><span>Pace: {wpm} words per minute</span><input id="cc-wpm" type="range" min={90} max={220} value={wpm} onChange={e => setWpm(+e.target.value)} /></label>
            <label className="field"><span>Text size</span><input id="cc-size" type="range" min={24} max={80} value={size} onChange={e => setSize(+e.target.value)} /></label>
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
            <label className="check"><input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />Mirror for a glass rig</label>
            {SRClass ? <label className="field" style={{ flex: "0 0 140px" }}><span>Voice language</span><select id="cc-lang" className="input" value={lang} onChange={e => setLang(e.target.value)}>{["en-US", "en-GB", "fr-FR", "ar-TN", "es-ES", "de-DE"].map(l => <option key={l}>{l}</option>)}</select></label>
              : <span className="note">Voice follow works in Chrome and Edge.</span>}
          </div>
        </Section>
      </div>

      <section className="panel cc-wrap">
        <div className="row cc-bar" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <button className="btn primary" onClick={() => setRunning(!running)}>{running ? "Pause" : elapsed ? "Resume" : "Start"}</button>
            <button className="btn" onClick={restart}>Restart</button>
            {SRClass && <button className="btn" aria-pressed={voice} onClick={toggleVoice}>{voice ? "Stop following voice" : "Follow my voice"}</button>}
            <button className="btn ghost" onClick={() => stage.current?.parentElement?.requestFullscreen?.().catch(() => {})}>Full screen</button>
          </div>
          <div className="row" style={{ alignItems: "center", gap: 18 }}>
            <span className="cc-clock num" style={{ color: over ? "#FF7A85" : undefined }}>{mmss(elapsed)}{budget ? ` / ${mmss(budget)}` : ""}</span>
            {curSec?.budget > 0 && <span className={"pill " + (secLeft < 0 ? "bad" : secLeft < 10 ? "warn" : "good")}>{curSec.title}: {secLeft < 0 ? `${mmss(-secLeft)} over` : `${mmss(secLeft)} left`}</span>}
          </div>
        </div>
        <div ref={stage} className="cc-stage" style={{ fontSize: size, transform: mirror ? "scaleX(-1)" : undefined }}>
          {secs.map((s, i) => (
            <div key={i}>
              <p className="cc-h">{s.title}</p>
              {s.text.split("\n").filter(Boolean).map((line, li) => (
                <p key={li}>{line.split(/\s+/).filter(Boolean).map(word => { const k = wi++; return <span key={k} data-w={k} className={k < pos ? "done" : k === pos ? "now" : ""}>{word} </span>; })}</p>
              ))}
            </div>
          ))}
          <div style={{ height: "60vh" }} />
        </div>
      </section>
      <style>{`.cc-wrap{background:#0B0D18;color:#EDEFF7}.cc-bar .btn{background:#1d2136;color:#EDEFF7;border-color:#2B3050}.cc-bar .btn.primary{background:#EDEFF7;color:#0B0D18}.cc-clock{font-family:var(--mono);font-size:20px}
      .cc-stage{height:60vh;overflow-y:auto;margin-top:14px;line-height:1.35;font-family:var(--sans);font-weight:600;padding-top:20vh}
      .cc-stage p{margin:0 0 .6em}.cc-h{font-family:var(--mono)!important;font-size:.35em;letter-spacing:.12em;text-transform:uppercase;color:#8FA6FF}
      .cc-stage span.done{color:#5d6380}.cc-stage span.now{background:#FFE800;color:#0B0D18;border-radius:4px}
      .cc-wrap:fullscreen{padding:3vw}.cc-wrap:fullscreen .cc-stage{height:85vh}`}</style>
    </div>
  );
}
