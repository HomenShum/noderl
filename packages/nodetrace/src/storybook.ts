/**
 * Trace Storybook v1 — a DETERMINISTIC HTML renderer of one `NodeMergedTrajectory`.
 *
 * This reads the merged trace JSON ONLY. It does NOT rebuild or drive the live NodeRoom app: the whole
 * point of the storybook is that anyone (reviewer, RL curator, judge) can open a single self-contained
 * .html and see the run — room goal + URL, the agent's chat/reasoning steps, the artifact tabs it
 * produced, the evidence it grounded (claim -> quote -> source, with the honest needs_review flag), the
 * total cost, and a pass/fail verdict — WITHOUT a server, a build, or network access.
 *
 * It is composed from COMPACT ATOMS (small pure functions, one per visual card) so the layout is easy to
 * reason about and each atom can be unit-tested in isolation. Every atom takes plain data off the merged
 * trajectory and returns an HTML fragment string.
 *
 * Honesty / safety doctrine (same as merged.ts — enforced here, not just documented):
 *  - DETERMINISTIC: no Date.now() / new Date() / Math.random() anywhere. Same input => byte-identical HTML.
 *    (There is no timestamp or nonce in the output. Ordering follows the trace arrays verbatim.)
 *  - HONEST_SCORES: the verdict + cost are derived from the trace ONLY. A reward component that is not on
 *    the trajectory is NOT invented — it is shown as "unscored:<name>" (surfaced from `reward.labels`),
 *    never a fabricated floor. If there is no reward at all, the verdict falls back to the UI assertions.
 *  - HONEST_STATUS: a `needs_review` evidence fact renders with a visible NEEDS REVIEW flag; a failing UI
 *    assertion renders as FAIL. The renderer never promotes either to a green state.
 *  - NO-LEAK: screenshots are rendered as PATHS (text), never as <img> data: URIs or inlined bytes. The
 *    renderer asserts (throws) if a screenshot path is actually inlined bytes, mirroring mergeTrajectory.
 *  - ESCAPED: every value taken off the trace is HTML-escaped before it reaches the output, so a claim /
 *    quote / URL / observation containing <, >, &, ", ' cannot break out of its element or inject markup.
 */
import type {
  NodeMergedTrajectory,
  OuterScreenshot,
  MergedStep,
  MergedArtifact,
  MergedEvidence,
  MergedReward,
  UiAssertion,
} from "./merged";

/* ------------------------------------------------------------------------------------------------ *
 * Primitives: escaping + a NO-LEAK guard reused from the merge doctrine.                            *
 * ------------------------------------------------------------------------------------------------ */

/** HTML-escape a value for safe text/attribute interpolation. Deterministic, total (coerces to string). */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** NO-LEAK: a screenshot path must be a real string ref, never inlined bytes or a data: URI. */
function assertScreenshotPathNotBytes(path: unknown, where: string): asserts path is string {
  if (path instanceof Uint8Array || path instanceof ArrayBuffer) {
    throw new Error(`NO-LEAK violation: ${where} carries inlined bytes; screenshots must be paths only`);
  }
  if (typeof path !== "string") {
    throw new Error(`${where} must be a string path, got ${typeof path}`);
  }
  if (path.startsWith("data:")) {
    throw new Error(`NO-LEAK violation: ${where} is a data: URI (inlined bytes); screenshots must be paths only`);
  }
}

/** Round a USD figure to cents for stable, deterministic display (no locale, no Intl). */
function usd(n: number): string {
  const cents = Math.round(n * 100);
  const dollars = Math.floor(cents / 100);
  const rem = Math.abs(cents % 100);
  return `$${dollars}.${String(rem).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------------------------------------ *
 * COMPACT ATOMS — one pure function per visual card. Each returns an escaped HTML fragment.         *
 * ------------------------------------------------------------------------------------------------ */

/** Room header: the user goal + the live room URL the outer proof drove. */
export function RoomHeaderAtom(goal: string, url: string): string {
  return (
    `<header class="nt-room-header" data-atom="room-header">` +
    `<div class="nt-room-kicker">NodeRoom run</div>` +
    `<h1 class="nt-room-goal" data-testid="room-goal">${esc(goal)}</h1>` +
    `<a class="nt-room-url" data-testid="room-url" href="${esc(url)}">${esc(url)}</a>` +
    `</header>`
  );
}

/** One agent chat/reasoning message (an inner-trace step). Cost/latency shown only when present. */
export function ChatMessageAtom(step: MergedStep): string {
  const meta: string[] = [`step ${esc(step.stepIndex)}`, esc(step.phase)];
  if (step.toolName) meta.push(`tool: ${esc(step.toolName)}`);
  if (typeof step.costUsd === "number" && Number.isFinite(step.costUsd)) meta.push(esc(usd(step.costUsd)));
  if (typeof step.latencyMs === "number" && Number.isFinite(step.latencyMs)) meta.push(`${esc(step.latencyMs)}ms`);

  const errorLine =
    typeof step.error === "string" && step.error.length > 0
      ? `<div class="nt-chat-error" data-testid="step-error">error: ${esc(step.error)}</div>`
      : "";

  return (
    `<div class="nt-chat-msg nt-phase-${esc(step.phase)}" data-atom="chat-message" data-phase="${esc(step.phase)}">` +
    `<div class="nt-chat-meta">${meta.join(" · ")}</div>` +
    `<div class="nt-chat-action">${esc(step.action)}</div>` +
    `<div class="nt-chat-observation">${esc(step.observation)}</div>` +
    errorLine +
    `</div>`
  );
}

/** An artifact tab: the deliverable's id/kind + its honest reopen proof + export path (text only). */
export function ArtifactTabAtom(artifact: MergedArtifact): string {
  const reopen =
    artifact.reopenPassed === undefined
      ? `<span class="nt-reopen nt-reopen-unknown">reopen: n/a</span>`
      : artifact.reopenPassed
        ? `<span class="nt-reopen nt-reopen-ok" data-testid="reopen-ok">reopen: OK</span>`
        : `<span class="nt-reopen nt-reopen-fail" data-testid="reopen-fail">reopen: FAILED</span>`;
  const exportLine = artifact.exportPath
    ? `<div class="nt-artifact-export">export: <code>${esc(artifact.exportPath)}</code></div>`
    : "";

  return (
    `<div class="nt-artifact-tab" data-atom="artifact-tab" data-kind="${esc(artifact.kind)}">` +
    `<span class="nt-artifact-kind">${esc(artifact.kind)}</span>` +
    `<span class="nt-artifact-id">${esc(artifact.artifactId)}</span>` +
    reopen +
    exportLine +
    `</div>`
  );
}

/**
 * An evidence card: claim -> quote -> source, with an explicit NEEDS REVIEW flag when the fact is not
 * source-backed. The status is rendered verbatim; needs_review is never hidden or promoted (HONEST_STATUS).
 */
export function EvidenceCardAtom(evidence: MergedEvidence): string {
  const needsReview = evidence.status === "needs_review";
  const flag = needsReview
    ? `<span class="nt-evidence-flag nt-needs-review" data-testid="needs-review">NEEDS REVIEW</span>`
    : `<span class="nt-evidence-flag nt-status-${esc(evidence.status)}">${esc(evidence.status)}</span>`;
  const quote = evidence.quote
    ? `<blockquote class="nt-evidence-quote">${esc(evidence.quote)}</blockquote>`
    : `<div class="nt-evidence-noquote">no quote supplied</div>`;
  const source = evidence.sourceUrl
    ? `<div class="nt-evidence-source">source: <span class="nt-evidence-url">${esc(evidence.sourceUrl)}</span></div>`
    : `<div class="nt-evidence-nosource">no source</div>`;

  return (
    `<div class="nt-evidence-card${needsReview ? " nt-evidence-needs-review" : ""}" data-atom="evidence-card"` +
    ` data-status="${esc(evidence.status)}"${needsReview ? ' data-needs-review="true"' : ""}>` +
    `<div class="nt-evidence-head"><span class="nt-evidence-claim">${esc(evidence.claim)}</span>${flag}</div>` +
    quote +
    source +
    `</div>`
  );
}

/** Cost badge: sums the per-step costUsd off the inner trace. Derived from the trace only (HONEST_SCORES). */
export function CostBadgeAtom(steps: MergedStep[]): string {
  let sum = 0;
  for (const s of steps) {
    if (typeof s.costUsd === "number" && Number.isFinite(s.costUsd)) sum += s.costUsd;
  }
  return (
    `<span class="nt-badge nt-cost-badge" data-atom="cost-badge" data-testid="cost-badge">` +
    `cost: ${esc(usd(sum))}` +
    `</span>`
  );
}

/**
 * Verdict badge: PASS/FAIL derived HONESTLY from the trace.
 *  - If a reward is present, PASS requires every UI assertion to pass AND no failureCategories; otherwise
 *    FAIL. The reward is not the source of truth for pass — the honest signals are — but its
 *    failureCategories are shown so a curator sees why.
 *  - If no reward is present, the verdict is derived purely from the UI assertions: PASS iff all passed
 *    (and at least one assertion exists); FAIL if any failed; UNVERIFIED if there are no assertions.
 * No fabricated score: when a reward exists we show its total; when it doesn't we show no number at all.
 */
export function VerdictBadgeAtom(reward: MergedReward | undefined, uiAssertions: UiAssertion[]): string {
  const anyAssertionFailed = uiAssertions.some((a) => a.passed === false);
  const hasAssertions = uiAssertions.length > 0;

  let verdict: "pass" | "fail" | "unverified";
  if (reward) {
    const hasFailureCat = reward.failureCategories.length > 0;
    verdict = anyAssertionFailed || hasFailureCat ? "fail" : hasAssertions ? "pass" : "unverified";
  } else {
    verdict = anyAssertionFailed ? "fail" : hasAssertions ? "pass" : "unverified";
  }

  const label = verdict === "pass" ? "PASS" : verdict === "fail" ? "FAIL" : "UNVERIFIED";
  // Only show a number that is actually on the trace. Never invent one.
  const totalPart = reward ? ` · total ${esc(reward.total.toFixed(3))}` : "";

  return (
    `<span class="nt-badge nt-verdict-badge nt-verdict-${verdict}" data-atom="verdict-badge"` +
    ` data-testid="verdict-badge" data-verdict="${verdict}">` +
    `verdict: ${label}${totalPart}` +
    `</span>`
  );
}

/**
 * Focus box: a single outer screenshot rendered as its PATH (never an inlined image). The label + the
 * visible component ids (the attention-overlay layer) are shown as text. NO-LEAK is enforced here too.
 */
export function FocusBoxAtom(shot: OuterScreenshot): string {
  assertScreenshotPathNotBytes(shot.path, `screenshot[${shot.label}].path`);
  const components = (shot.visibleComponentIds ?? [])
    .map((id) => `<code class="nt-focus-component">${esc(id)}</code>`)
    .join(" ");
  const componentLine = components ? `<div class="nt-focus-components">${components}</div>` : "";
  return (
    `<figure class="nt-focus-box" data-atom="focus-box" data-label="${esc(shot.label)}">` +
    `<figcaption class="nt-focus-label">${esc(shot.label)}</figcaption>` +
    // PATH ONLY — deliberately NOT an <img src>. This is the NO-LEAK guarantee made visible.
    `<div class="nt-focus-path">screenshot: <code>${esc(shot.path)}</code></div>` +
    componentLine +
    `</figure>`
  );
}

/* ------------------------------------------------------------------------------------------------ *
 * Static, deterministic stylesheet. No external fonts/urls; inline so the .html is self-contained.  *
 * ------------------------------------------------------------------------------------------------ */

const STORYBOOK_CSS = `
:root{--nt-bg:#0e1116;--nt-panel:#161b22;--nt-border:#30363d;--nt-fg:#e6edf3;--nt-muted:#8b949e;
--nt-pass:#2ea043;--nt-fail:#f85149;--nt-warn:#d29922;--nt-accent:#58a6ff;}
*{box-sizing:border-box}
body.nt-storybook{margin:0;background:var(--nt-bg);color:var(--nt-fg);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;}
.nt-wrap{max-width:900px;margin:0 auto;padding:24px}
.nt-room-header{border-bottom:1px solid var(--nt-border);padding-bottom:16px;margin-bottom:16px}
.nt-room-kicker{color:var(--nt-muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px}
.nt-room-goal{margin:.2em 0;font-size:22px}
.nt-room-url{color:var(--nt-accent);text-decoration:none;font-size:13px;word-break:break-all}
.nt-badges{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 20px}
.nt-badge{display:inline-block;padding:4px 10px;border-radius:999px;font-weight:600;font-size:12px;
border:1px solid var(--nt-border);background:var(--nt-panel)}
.nt-verdict-pass{color:#fff;background:var(--nt-pass);border-color:var(--nt-pass)}
.nt-verdict-fail{color:#fff;background:var(--nt-fail);border-color:var(--nt-fail)}
.nt-verdict-unverified{color:var(--nt-warn);border-color:var(--nt-warn)}
.nt-section-title{margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--nt-muted)}
.nt-artifact-tabs{display:flex;gap:8px;flex-wrap:wrap}
.nt-artifact-tab{background:var(--nt-panel);border:1px solid var(--nt-border);border-radius:8px;padding:8px 12px;font-size:13px}
.nt-artifact-kind{display:inline-block;background:#21262d;border-radius:4px;padding:1px 6px;margin-right:6px;font-size:11px;text-transform:uppercase}
.nt-artifact-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.nt-reopen{margin-left:8px;font-size:11px}
.nt-reopen-ok{color:var(--nt-pass)} .nt-reopen-fail{color:var(--nt-fail)} .nt-reopen-unknown{color:var(--nt-muted)}
.nt-artifact-export{color:var(--nt-muted);font-size:11px;margin-top:4px}
.nt-chat-msg{background:var(--nt-panel);border:1px solid var(--nt-border);border-left:3px solid var(--nt-accent);
border-radius:8px;padding:10px 12px;margin-bottom:8px}
.nt-chat-meta{color:var(--nt-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.nt-chat-action{margin-top:4px}
.nt-chat-observation{margin-top:4px;color:var(--nt-muted)}
.nt-chat-error{margin-top:4px;color:var(--nt-fail)}
.nt-evidence-card{background:var(--nt-panel);border:1px solid var(--nt-border);border-radius:8px;padding:12px;margin-bottom:8px}
.nt-evidence-needs-review{border-color:var(--nt-warn)}
.nt-evidence-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.nt-evidence-claim{font-weight:600}
.nt-evidence-flag{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--nt-border);white-space:nowrap}
.nt-needs-review{color:#fff;background:var(--nt-warn);border-color:var(--nt-warn)}
.nt-status-source_backed{color:var(--nt-pass)}
.nt-evidence-quote{margin:8px 0;padding:6px 10px;border-left:2px solid var(--nt-border);color:var(--nt-fg)}
.nt-evidence-noquote,.nt-evidence-nosource{color:var(--nt-muted);font-style:italic;font-size:12px}
.nt-evidence-source{color:var(--nt-muted);font-size:12px}
.nt-evidence-url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.nt-focus-box{background:var(--nt-panel);border:1px dashed var(--nt-border);border-radius:8px;padding:10px 12px;margin:0 0 8px}
.nt-focus-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--nt-muted)}
.nt-focus-path{font-size:12px;margin-top:4px}
.nt-focus-components{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
.nt-focus-component{background:#21262d;border-radius:4px;padding:1px 6px;font-size:11px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.nt-console-errors{color:var(--nt-fail);font-size:12px}
.nt-empty{color:var(--nt-muted);font-style:italic;font-size:12px}
.nt-footer{margin-top:28px;padding-top:12px;border-top:1px solid var(--nt-border);color:var(--nt-muted);font-size:11px}
`.trim();

/* ------------------------------------------------------------------------------------------------ *
 * renderStorybook — compose the atoms into one self-contained, deterministic HTML document.         *
 * ------------------------------------------------------------------------------------------------ */

/** Wrap a group of atom fragments under a section heading; show an empty note when there is nothing. */
function section(title: string, body: string, emptyNote: string): string {
  return (
    `<section class="nt-section" data-section="${esc(title.toLowerCase().replace(/\s+/g, "-"))}">` +
    `<h2 class="nt-section-title">${esc(title)}</h2>` +
    (body.length > 0 ? body : `<div class="nt-empty">${esc(emptyNote)}</div>`) +
    `</section>`
  );
}

/**
 * Render one merged trajectory to a self-contained HTML string.
 *
 * DETERMINISTIC: the output depends ONLY on `t`. No clock, no randomness, no environment. The same
 * trajectory always yields a byte-identical string, so it can be content-hashed / diffed / committed.
 */
export function renderStorybook(t: NodeMergedTrajectory): string {
  const header = RoomHeaderAtom(t.userGoal, t.outerTrace.url);
  const cost = CostBadgeAtom(t.innerTrace.steps);
  const verdict = VerdictBadgeAtom(t.reward, t.outerTrace.uiAssertions);

  // Surface honest "unscored:<name>" labels from the reward (never a fabricated floor).
  const unscored = (t.reward?.labels ?? []).filter((l) => l.startsWith("unscored:"));
  const unscoredBadge =
    unscored.length > 0
      ? `<span class="nt-badge nt-unscored-badge" data-testid="unscored-badge">` +
        `${esc(unscored.length)} unscored: ${unscored.map((l) => esc(l)).join(", ")}</span>`
      : "";

  const modelBadge = t.innerTrace.model
    ? `<span class="nt-badge nt-model-badge">model: ${esc(t.innerTrace.model)}</span>`
    : "";
  const runBadge = `<span class="nt-badge nt-run-badge">run: ${esc(t.runId)}</span>`;

  const badges =
    `<div class="nt-badges">${verdict}${cost}${modelBadge}${runBadge}${unscoredBadge}</div>`;

  const screenshots = section(
    "Focus boxes",
    t.outerTrace.screenshots.map((s) => FocusBoxAtom(s)).join(""),
    "no screenshots captured",
  );

  const artifacts = section(
    "Artifacts",
    `<div class="nt-artifact-tabs">${t.artifacts.map((a) => ArtifactTabAtom(a)).join("")}</div>`,
    "no artifacts produced",
  );

  const chat = section(
    "Agent trace",
    t.innerTrace.steps.map((s) => ChatMessageAtom(s)).join(""),
    "no reasoning steps recorded",
  );

  const evidence = section(
    "Evidence",
    t.evidence.map((e) => EvidenceCardAtom(e)).join(""),
    "no evidence grounded",
  );

  const consoleErrors =
    t.outerTrace.consoleErrors.length > 0
      ? section(
          "Console errors",
          `<ul class="nt-console-errors">` +
            t.outerTrace.consoleErrors.map((e) => `<li>${esc(e)}</li>`).join("") +
            `</ul>`,
          "",
        )
      : "";

  const assertions = section(
    "UI assertions",
    t.outerTrace.uiAssertions
      .map(
        (a) =>
          `<div class="nt-artifact-tab" data-testid="ui-assertion" data-passed="${a.passed}">` +
          `<span class="nt-reopen ${a.passed ? "nt-reopen-ok" : "nt-reopen-fail"}">${a.passed ? "PASS" : "FAIL"}</span> ` +
          `<span>${esc(a.expected)}</span>` +
          `<div class="nt-artifact-export">observed: ${esc(a.observed)}</div>` +
          `</div>`,
      )
      .join(""),
    "no UI assertions",
  );

  const failureCats =
    t.reward && t.reward.failureCategories.length > 0
      ? section(
          "Failure categories",
          `<div class="nt-artifact-tabs">` +
            t.reward.failureCategories
              .map((c) => `<span class="nt-badge nt-verdict-fail" data-testid="failure-category">${esc(c)}</span>`)
              .join("") +
            `</div>`,
          "",
        )
      : "";

  // Everything is escaped upstream; trajectoryId matches /^mtraj_[0-9a-f]+$/ or a caller string (escaped).
  return (
    `<!doctype html>` +
    `<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Trace Storybook — ${esc(t.userGoal)}</title>` +
    `<style>${STORYBOOK_CSS}</style>` +
    `</head><body class="nt-storybook" data-trajectory-id="${esc(t.trajectoryId)}">` +
    `<div class="nt-wrap">` +
    header +
    badges +
    assertions +
    failureCats +
    artifacts +
    chat +
    evidence +
    screenshots +
    consoleErrors +
    `<footer class="nt-footer">Deterministic render of trajectory ` +
    `<code>${esc(t.trajectoryId)}</code>. Screenshots are paths only (no inlined bytes).</footer>` +
    `</div>` +
    `</body></html>`
  );
}
