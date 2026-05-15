import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HighlightSegment, LibraryItem } from "../shared/types";

type SettingsForm = {
  targetDurationSec: number;
  maxSegments: number;
  segmentWindowSec: number;
  sceneThreshold: number;
  motionFps: number;
  motionScaleWidth: number;
  loudnorm: boolean;
  useXfade: boolean;
  xfadeSec: number;
  ffmpegPath: string;
  ffprobePath: string;
  qwenApiKey: string;
  qwenModel: string;
  qwenHighlightMode: "none" | "rerank" | "audio" | "transcript";
  qwenAudioModel: string;
  qwenInstruction: string;
};

type ProgressUi = {
  mode: "none" | "analyze" | "job";
  text: string;
  barPct: number;
};

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.max(10, Math.ceil(max * 0.48) - 1);
  const tail = max - head - 1;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function normalizeQwenMode(
  s: Record<string, unknown>
): "none" | "rerank" | "audio" | "transcript" {
  const m = s.qwenHighlightMode;
  if (m === "rerank" || m === "audio" || m === "transcript") return m;
  if (s.qwenRerankEnabled === true) return "rerank";
  return "none";
}

function normalizeFromApi(s: Record<string, unknown>): SettingsForm {
  return {
    targetDurationSec: Number(s.targetDurationSec) || 60,
    maxSegments: Number(s.maxSegments) || 8,
    segmentWindowSec: Number(s.segmentWindowSec) || 2.5,
    sceneThreshold: Number(s.sceneThreshold) || 0.32,
    motionFps: Number(s.motionFps) || 2,
    motionScaleWidth: Number(s.motionScaleWidth) || 160,
    loudnorm: Boolean(s.loudnorm),
    useXfade: Boolean(s.useXfade),
    xfadeSec: Number(s.xfadeSec) || 0.45,
    ffmpegPath: String(s.ffmpegPath ?? ""),
    ffprobePath: String(s.ffprobePath ?? ""),
    qwenApiKey: String(s.qwenApiKey ?? ""),
    qwenModel: String(s.qwenModel ?? "qwen3.6-plus"),
    qwenHighlightMode: normalizeQwenMode(s),
    qwenAudioModel: String(s.qwenAudioModel ?? "qwen3-omni-flash"),
    qwenInstruction: String(s.qwenInstruction ?? ""),
  };
}

function clampWindow(raw: number): number {
  return Number.isFinite(raw) ? Math.min(120, Math.max(1.5, raw)) : 2.5;
}

function formToPersisted(f: SettingsForm): SettingsForm {
  return { ...f, segmentWindowSec: clampWindow(f.segmentWindowSec) };
}

export default function App() {
  const [libraryOrder, setLibraryOrder] = useState<LibraryItem[]>([]);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<SettingsForm | null>(null);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaNotes, setMetaNotes] = useState("");
  const [lastSegments, setLastSegments] = useState<HighlightSegment[]>([]);
  const [segmentNote, setSegmentNote] = useState("");
  const [longJobRunning, setLongJobRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<ProgressUi>({
    mode: "none",
    text: "",
    barPct: 0,
  });
  const [toast, setToast] = useState<string | null>(null);

  const unsubProgressRef = useRef<(() => void) | null>(null);
  const searchBootRef = useRef(true);

  useEffect(() => {
    return () => {
      unsubProgressRef.current?.();
      unsubProgressRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = (await window.api.settingsGet()) as Record<string, unknown>;
      if (cancelled) return;
      setOptions(normalizeFromApi(s));
      const items = await window.api.libraryList();
      if (!cancelled) setLibraryOrder(items);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (searchBootRef.current) {
      searchBootRef.current = false;
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const items = search.trim()
          ? await window.api.librarySearch(search.trim())
          : await window.api.libraryList();
        if (cancelled) return;
        setLibraryOrder(items);
        setCheckedIds(
          (prev) => new Set([...prev].filter((x) => items.some((i) => i.id === x)))
        );
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [search]);

  const checkedPathsInOrder = useMemo(
    () =>
      libraryOrder
        .filter((it) => checkedIds.has(it.id))
        .map((it) => it.path),
    [libraryOrder, checkedIds]
  );

  const checkedIdList = useMemo(
    () => libraryOrder.filter((it) => checkedIds.has(it.id)).map((it) => it.id),
    [libraryOrder, checkedIds]
  );

  const compileDisabled = longJobRunning || checkedIds.size < 1;
  const analyzeDisabled = longJobRunning || !selected || analyzing;
  const renderDisabled =
    longJobRunning || !selected || lastSegments.length === 0;

  const selectedPathDisplay = selected?.path
    ? truncateMiddle(selected.path, 78)
    : "未选择素材";

  const patchOptions = useCallback((p: Partial<SettingsForm>) => {
    setOptions((o) => (o ? { ...o, ...p } : o));
  }, []);

  const runHighlightAnalyze = useCallback(async () => {
    if (!selected || longJobRunning || !options) return;
    const persisted = formToPersisted(options);
    await window.api.settingsSet(persisted as Record<string, unknown>);
    setLongJobRunning(true);
    setAnalyzing(true);
    setProgress({ mode: "analyze", text: "正在分析", barPct: 0 });
    try {
      const r = await window.api.analyze(selected.path, {
        targetDurationSec: persisted.targetDurationSec,
        maxSegments: persisted.maxSegments,
        segmentWindowSec: persisted.segmentWindowSec,
        sceneThreshold: persisted.sceneThreshold,
        motionFps: persisted.motionFps,
        motionScaleWidth: persisted.motionScaleWidth,
      });
      setLastSegments(r.segments);
      const sample = r.segments[0];
      const segLen =
        sample != null
          ? (sample.endSec - sample.startSec).toFixed(1)
          : "—";
      setSegmentNote(
        `共 ${r.segments.length} 段，单段约 ${segLen}s（高光窗长 ${persisted.segmentWindowSec}s）。修改主进程逻辑后需重启应用再分析。${
          persisted.qwenHighlightMode === "audio"
            ? " 听音高光：时间相对片头 0 秒起算（当前仅截取约 2 分钟音轨送模型）。"
            : persisted.qwenHighlightMode === "transcript"
              ? " 字幕再选：先分块转写（最多约前 14 分钟），再由文本模型按字幕选时间段；失败则回退本地算法。"
              : ""
        }`
      );
      if (r.segments.length > 0) setToast("分析完成");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress({ mode: "none", text: "", barPct: 0 });
      setAnalyzing(false);
      setLongJobRunning(false);
    }
  }, [selected, longJobRunning, options]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (analyzeDisabled) return;
      if (!selected) return;
      e.preventDefault();
      void runHighlightAnalyze();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [analyzeDisabled, selected, runHighlightAnalyze]);

  const onRemove = async () => {
    const primaryId = selected?.id;
    const idsToRemove =
      checkedIdList.length > 0
        ? [...new Set(checkedIdList)]
        : primaryId != null
          ? [primaryId]
          : [];
    if (idsToRemove.length === 0) {
      alert(
        "请先指定要移除的素材：勾选左侧复选框（可多选），或点击某一行为当前素材后再点移除。"
      );
      return;
    }
    const removedHasCurrent =
      primaryId != null && idsToRemove.includes(primaryId);
    try {
      for (const id of idsToRemove) {
        await window.api.libraryRemove(id);
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
      const items = search.trim()
        ? await window.api.librarySearch(search.trim())
        : await window.api.libraryList();
      setLibraryOrder(items);
      return;
    }
    if (removedHasCurrent) {
      setSelected(null);
      setLastSegments([]);
      setSegmentNote("");
      setMetaTitle("");
      setMetaNotes("");
    }
    const items = search.trim()
      ? await window.api.librarySearch(search.trim())
      : await window.api.libraryList();
    setLibraryOrder(items);
    setCheckedIds((prev) => new Set([...prev].filter((id) => items.some((i) => i.id === id))));
    setToast(idsToRemove.length === 1 ? "已移除 1 项" : `已移除 ${idsToRemove.length} 项`);
  };

  const onSaveMeta = async () => {
    if (!selected) {
      alert("请先选择一个素材");
      return;
    }
    const title = metaTitle.trim();
    const notes = metaNotes.trim();
    const updated = await window.api.libraryUpdateMeta(selected.id, { title, notes });
    if (updated) setSelected(updated);
    const items = search.trim()
      ? await window.api.librarySearch(search.trim())
      : await window.api.libraryList();
    setLibraryOrder(items);
    setToast("元数据已保存");
  };

  const onAdd = async () => {
    const added = await window.api.libraryAdd();
    const items = search.trim()
      ? await window.api.librarySearch(search.trim())
      : await window.api.libraryList();
    setLibraryOrder(items);
    if (added.length && !selected) {
      const first = added[0]!;
      setSelected(first);
      setMetaTitle(first.title);
      setMetaNotes(first.notes);
    }
  };

  const onSaveSettings = async () => {
    if (!options) return;
    await window.api.settingsSet(formToPersisted(options) as Record<string, unknown>);
    const s = (await window.api.settingsGet()) as Record<string, unknown>;
    setOptions(normalizeFromApi(s));
    setToast("设置已保存");
  };

  const onRender = async () => {
    if (!selected || lastSegments.length === 0 || !options) return;
    const out = await window.api.pickSave();
    if (!out) return;
    const s = formToPersisted(options);
    await window.api.settingsSet(s as Record<string, unknown>);
    setLongJobRunning(true);
    const jobId = `render_${Date.now()}`;
    setProgress({ mode: "job", text: "排队中…", barPct: 0 });
    unsubProgressRef.current?.();
    unsubProgressRef.current = window.api.onRenderProgress((p) => {
      if (p.jobId !== jobId) return;
      setProgress({
        mode: "job",
        text: `${p.phase}: ${p.message}`,
        barPct: Math.round(p.percent),
      });
    });
    try {
      const res = await window.api.render({
        jobId,
        inputPath: selected.path,
        segments: lastSegments,
        outputPath: out,
        render: {
          outputPath: out,
          useXfade: s.useXfade,
          xfadeSec: s.xfadeSec,
          loudnorm: s.loudnorm,
        },
      });
      setProgress({
        mode: "job",
        text: `完成：${out} · EDL ${res.edlPath}`,
        barPct: 100,
      });
      setToast("导出完成");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      unsubProgressRef.current?.();
      unsubProgressRef.current = null;
      setLongJobRunning(false);
      setProgress({ mode: "none", text: "", barPct: 0 });
    }
  };

  const onCompile = async () => {
    if (checkedPathsInOrder.length === 0) {
      alert(
        "请勾选一个或多个素材；顺序为当前列表从上到下（可用搜索筛选后再勾选）。"
      );
      return;
    }
    if (!options) return;
    const out = await window.api.pickSave();
    if (!out) return;
    const s = formToPersisted(options);
    await window.api.settingsSet(s as Record<string, unknown>);
    setLongJobRunning(true);
    const jobId = `compile_${Date.now()}`;
    setProgress({ mode: "job", text: "排队中…", barPct: 0 });
    unsubProgressRef.current?.();
    unsubProgressRef.current = window.api.onRenderProgress((p) => {
      if (p.jobId !== jobId) return;
      setProgress({
        mode: "job",
        text: `${p.phase}: ${p.message}`,
        barPct: Math.round(p.percent),
      });
    });
    try {
      const res = await window.api.compileReel({
        jobId,
        paths: checkedPathsInOrder,
        analyzeOptions: {
          targetDurationSec: s.targetDurationSec,
          maxSegments: s.maxSegments,
          segmentWindowSec: s.segmentWindowSec,
          sceneThreshold: s.sceneThreshold,
          motionFps: s.motionFps,
          motionScaleWidth: s.motionScaleWidth,
        },
        render: {
          outputPath: out,
          useXfade: s.useXfade,
          xfadeSec: s.xfadeSec,
          loudnorm: s.loudnorm,
        },
        outputPath: out,
      });
      setProgress({
        mode: "job",
        text: `合成完成：${out} · EDL ${res.edlPath}`,
        barPct: 100,
      });
      setToast("合成完成");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      unsubProgressRef.current?.();
      unsubProgressRef.current = null;
      setLongJobRunning(false);
      setProgress({ mode: "none", text: "", barPct: 0 });
    }
  };

  if (!options) {
    return (
      <div className="header">
        <p className="subtitle">加载中…</p>
      </div>
    );
  }

  return (
    <>
      <header className="header">
        <div>
          <h1>HighlightClip</h1>
          <p className="subtitle">本地素材库 · 关键词筛选 · 自动高光 · FFmpeg 导出</p>
        </div>
      </header>

      <main className="grid">
        <section className="panel">
          <h2>素材库</h2>
          <div className="row">
            <button type="button" onClick={() => void onAdd()}>
              导入视频
            </button>
            <button id="btn-remove" type="button" onClick={() => void onRemove()}>
              移除所选
            </button>
            <button
              id="btn-compile-reel"
              type="button"
              disabled={compileDisabled}
              onClick={() => void onCompile()}
            >
              合成勾选（多素材）
            </button>
            <input
              id="search"
              type="search"
              placeholder="按标题、备注或路径搜索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              id="btn-clear-search"
              type="button"
              onClick={() => {
                setSearch("");
              }}
            >
              清空
            </button>
          </div>
          <p className="muted small-hint">
            勾选多个素材后点「合成勾选」：按当前列表顺序分别分析高光，再拼接为一条成片（仅本地文件）。「移除所选」会移除左侧已勾选的项；未勾选时则移除当前点击选中的那一行。
          </p>
          <div className="meta-row">
            <label className="grow">
              标题{" "}
              <input
                id="meta-title"
                type="text"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
              />
            </label>
            <label className="grow">
              备注{" "}
              <input
                id="meta-notes"
                type="text"
                value={metaNotes}
                onChange={(e) => setMetaNotes(e.target.value)}
              />
            </label>
            <button id="btn-save-meta" type="button" onClick={() => void onSaveMeta()}>
              保存元数据
            </button>
          </div>
          <ul id="library-list" className="library">
            {libraryOrder.length === 0 ? (
              <li className="library-empty">
                暂无素材，点击「导入视频」添加本地视频
              </li>
            ) : (
              libraryOrder.map((it) => (
                <li
                  key={it.id}
                  data-id={it.id}
                  className={selected?.id === it.id ? "active" : undefined}
                  onClick={(ev) => {
                    if ((ev.target as HTMLElement).closest(".lib-check")) return;
                    setSelected(it);
                    setMetaTitle(it.title);
                    setMetaNotes(it.notes);
                  }}
                >
                  <input
                    type="checkbox"
                    className="lib-check"
                    title="参与多素材合成"
                    checked={checkedIds.has(it.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setCheckedIds((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(it.id);
                        else n.delete(it.id);
                        return n;
                      });
                    }}
                  />
                  <span className="lib-title">
                    {it.title} — {it.path}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="panel">
          <h2>分析与导出</h2>
          <p
            id="selected-path"
            className="muted path-display"
            title={selected?.path ?? undefined}
          >
            {selectedPathDisplay}
          </p>
          <div className="row wrap options-row">
            <label>
              目标总时长 (秒) <span className="field-hint">成片总长上限</span>{" "}
              <input
                id="opt-dur"
                type="number"
                min={10}
                max={600}
                value={options.targetDurationSec}
                onChange={(e) =>
                  patchOptions({ targetDurationSec: Number(e.target.value) || 60 })
                }
              />
            </label>
            <label>
              最多片段数 <span className="field-hint">高光条数上限</span>{" "}
              <input
                id="opt-seg"
                type="number"
                min={1}
                max={240}
                value={options.maxSegments}
                onChange={(e) =>
                  patchOptions({ maxSegments: Number(e.target.value) || 8 })
                }
              />
            </label>
            <label>
              高光窗长 (秒) <span className="field-hint">单段时长</span>{" "}
              <input
                id="opt-window"
                type="number"
                step={0.5}
                min={1.5}
                max={120}
                value={options.segmentWindowSec}
                onChange={(e) =>
                  patchOptions({
                    segmentWindowSec: Number(e.target.value) || 2.5,
                  })
                }
              />
            </label>
            <label>
              场景阈值 <span className="field-hint">切镜灵敏度</span>{" "}
              <input
                id="opt-scene"
                type="number"
                step={0.02}
                min={0.1}
                max={0.9}
                value={options.sceneThreshold}
                onChange={(e) =>
                  patchOptions({ sceneThreshold: Number(e.target.value) || 0.32 })
                }
              />
            </label>
          </div>
          <p className="muted small-hint">
            「高光窗长 / 单段时长」控制<strong>每一条</strong>候选高光大约多少秒；「目标总时长」是<strong>多条拼起来</strong>的上限。不要只改「目标总时长」却期望单段变长。改窗长后须重新点「分析高光」。
          </p>
          <div className="row wrap">
            <label>
              运动采样 FPS{" "}
              <input
                id="opt-fps"
                type="number"
                min={1}
                max={6}
                value={options.motionFps}
                onChange={(e) =>
                  patchOptions({ motionFps: Number(e.target.value) || 2 })
                }
              />
            </label>
            <label>
              运动分析宽度{" "}
              <input
                id="opt-scale"
                type="number"
                min={64}
                max={320}
                step={16}
                value={options.motionScaleWidth}
                onChange={(e) =>
                  patchOptions({ motionScaleWidth: Number(e.target.value) || 160 })
                }
              />
            </label>
          </div>
          <div className="row wrap">
            <label>
              <input
                id="opt-loudnorm"
                type="checkbox"
                checked={options.loudnorm}
                onChange={(e) => patchOptions({ loudnorm: e.target.checked })}
              />{" "}
              导出时响度归一 (loudnorm)
            </label>
            <label>
              <input
                id="opt-xfade"
                type="checkbox"
                checked={options.useXfade}
                onChange={(e) => patchOptions({ useXfade: e.target.checked })}
              />{" "}
              片段间视频交叉淡化
            </label>
            <label>
              淡化时长 (秒){" "}
              <input
                id="opt-xfade-dur"
                type="number"
                step={0.05}
                min={0.1}
                max={2}
                value={options.xfadeSec}
                onChange={(e) =>
                  patchOptions({ xfadeSec: Number(e.target.value) || 0.45 })
                }
              />
            </label>
          </div>
          <div className="row actions-row">
            <button
              id="btn-analyze"
              type="button"
              className="btn-primary"
              disabled={analyzeDisabled}
              aria-busy={analyzing || undefined}
              onClick={() => void runHighlightAnalyze()}
            >
              {analyzing ? "正在分析…" : "分析高光"}
            </button>
            <button
              id="btn-render"
              type="button"
              className="btn-secondary"
              disabled={renderDisabled}
              onClick={() => void onRender()}
            >
              导出成片
            </button>
          </div>
          <p className="muted small-hint kbd-hint">
            快捷键：<kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>Enter</kbd>{" "}
            触发分析（焦点在任意输入框或文本框内时不触发）。
          </p>
          <div
            id="progress"
            className={`progress ${progress.mode === "none" ? "hidden" : ""} ${progress.mode === "analyze" ? "analyze-pending" : ""}`}
            aria-live={progress.mode !== "none" ? "polite" : undefined}
          >
            <div className="bar">
              <div
                id="progress-bar"
                className="inner"
                style={
                  progress.mode === "job"
                    ? { width: `${progress.barPct}%` }
                    : progress.mode === "analyze"
                      ? undefined
                      : { width: "0%" }
                }
              />
            </div>
            <p id="progress-text" className="muted">
              {progress.text}
            </p>
          </div>
          <h3>候选片段</h3>
          <p id="segments-analyze-note" className="muted small-hint">
            {segmentNote}
          </p>
          <ul id="segments" className="segments">
            {lastSegments.map((s, i) => {
              const dur = s.endSec - s.startSec;
              return (
                <li key={`${s.startSec}-${s.endSec}-${i}`}>
                  {s.startSec.toFixed(2)}s – {s.endSec.toFixed(2)}s（{dur.toFixed(1)}
                  s）· score {s.score.toFixed(3)} (motion {s.motion.toFixed(2)}, audio{" "}
                  {s.audio.toFixed(2)}, scene {s.scene.toFixed(2)})
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <h2>设置</h2>
          <p className="muted">FFmpeg / FFprobe 可留空以使用内置二进制（随依赖安装）。</p>
          <label className="block">
            自定义 ffmpeg 路径
            <input
              id="set-ffmpeg"
              type="text"
              placeholder="默认内置"
              value={options.ffmpegPath}
              onChange={(e) => patchOptions({ ffmpegPath: e.target.value })}
            />
          </label>
          <label className="block">
            自定义 ffprobe 路径
            <input
              id="set-ffprobe"
              type="text"
              placeholder="默认内置"
              value={options.ffprobePath}
              onChange={(e) => patchOptions({ ffprobePath: e.target.value })}
            />
          </label>
          <h3 className="settings-sub">通义千问（阿里云百炼）</h3>
          <p className="muted small-hint">
            在{" "}
            <a
              href="https://bailian.console.aliyun.com/"
              target="_blank"
              rel="noreferrer"
            >
              百炼控制台
            </a>{" "}
            创建 API Key（<code>sk-…</code>）。应用通过百炼提供的 OpenAI 兼容地址{" "}
            <code>dashscope.aliyuncs.com/compatible-mode/v1/chat/completions</code>{" "}
            调用，与控制台密钥一致。Key 仅存本机，勿提交到 Git。
          </p>
          <label className="block">
            百炼 API Key
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-…（百炼控制台）"
              value={options.qwenApiKey}
              onChange={(e) => patchOptions({ qwenApiKey: e.target.value })}
            />
          </label>
          <div className="qwen-mode-row block">
            <span className="muted" style={{ display: "block", marginBottom: "0.35rem" }}>
              高光分析方式
            </span>
            <label className="inline-radio">
              <input
                type="radio"
                name="qwen-highlight-mode"
                checked={options.qwenHighlightMode === "none"}
                onChange={() => patchOptions({ qwenHighlightMode: "none" })}
              />{" "}
              仅本地算法（FFmpeg 运动/音量/镜头）
            </label>
            <label className="inline-radio">
              <input
                type="radio"
                name="qwen-highlight-mode"
                checked={options.qwenHighlightMode === "rerank"}
                onChange={() => patchOptions({ qwenHighlightMode: "rerank" })}
              />{" "}
              算法候选 + 千问文本重排（需文本模型）
            </label>
            <label className="inline-radio">
              <input
                type="radio"
                name="qwen-highlight-mode"
                checked={options.qwenHighlightMode === "transcript"}
                onChange={() => patchOptions({ qwenHighlightMode: "transcript" })}
              />{" "}
              先转字幕再选（分块听写 + 文本模型选段；最多约前 14 分钟，失败则回退算法）
            </label>
            <label className="inline-radio">
              <input
                type="radio"
                name="qwen-highlight-mode"
                checked={options.qwenHighlightMode === "audio"}
                onChange={() => patchOptions({ qwenHighlightMode: "audio" })}
              />{" "}
              千问听音直出（多模态；仅分析片头约 2 分钟音频，失败则回退算法）
            </label>
          </div>
          <label className="block">
            文本模型（用于「重排」与「字幕再选」选段）
            <input
              type="text"
              placeholder="qwen3.6-plus"
              value={options.qwenModel}
              onChange={(e) => patchOptions({ qwenModel: e.target.value })}
              disabled={
                options.qwenHighlightMode !== "rerank" &&
                options.qwenHighlightMode !== "transcript"
              }
            />
          </label>
          <label className="block">
            听音多模态模型（用于「直出」与「字幕再选」转写）
            <input
              type="text"
              placeholder="qwen3-omni-flash"
              value={options.qwenAudioModel}
              onChange={(e) => patchOptions({ qwenAudioModel: e.target.value })}
              disabled={
                options.qwenHighlightMode !== "audio" &&
                options.qwenHighlightMode !== "transcript"
              }
            />
          </label>
          <label className="block">
            偏好说明（可选，重排、听音与字幕模式均会参考）
            <input
              type="text"
              placeholder="例如：优先节奏快、少废话的片段"
              value={options.qwenInstruction}
              onChange={(e) => patchOptions({ qwenInstruction: e.target.value })}
            />
          </label>
          <button type="button" onClick={() => void onSaveSettings()}>
            保存设置
          </button>
        </section>
      </main>

      <div
        id="toast"
        className={`toast ${toast ? "toast-visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast ?? ""}
      </div>
    </>
  );
}
