import { useEffect, useMemo } from "react";
import { Plus, Trash2, Tv, Smartphone, ShieldCheck, Gamepad2, Lock } from "lucide-react";

import {
  normalizeGameDevicePerformance,
  resolveGamePlatformKey,
  type DevicePerformance,
  type DeviceModePerformance,
} from "@/lib/devicePerformance";

type Record_ = Record<string, any>;

function TextField({
  label,
  value,
  onChange,
  required,
  type = "text",
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-bold">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </span>
      <input
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}

function BooleanSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold">{label}</span>
      <select
        value={value === undefined ? "" : value ? "true" : "false"}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value === "true")
        }
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">Not Published</option>
        <option value="true">Supported / Yes</option>
        <option value="false">Not Supported / No</option>
      </select>
    </label>
  );
}

function PlayModeEditor({
  title,
  icon: Icon,
  mode,
  required,
  onChange,
}: {
  title: string;
  icon: typeof Tv;
  mode?: DeviceModePerformance;
  required: boolean;
  onChange: (mode: DeviceModePerformance) => void;
}) {
  const current = mode || { supported: true };
  const set = (key: keyof DeviceModePerformance, value: unknown) =>
    onChange({ ...current, [key]: value });
  const supported = current.supported !== false;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 font-bold">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h4>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={!supported}
            onChange={(event) => set("supported", !event.target.checked)}
          />
          Not Supported
        </label>
      </div>
      {supported ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Resolution"
            required={required}
            value={current.resolution}
            onChange={(next) => set("resolution", next)}
            placeholder="1920x1080 or Dynamic 1080p"
          />
          <TextField
            label="Rendering Resolution"
            value={current.renderingResolution}
            onChange={(next) => set("renderingResolution", next)}
          />
          <TextField
            label="Output Resolution"
            value={current.outputResolution}
            onChange={(next) => set("outputResolution", next)}
          />
          <TextField
            label="FPS"
            required={required}
            value={current.fps}
            onChange={(next) => set("fps", next)}
            placeholder="60, 30–60, Unlocked, Dynamic"
          />
          <TextField
            label="FPS Min"
            value={current.fpsMin}
            onChange={(next) => set("fpsMin", next)}
          />
          <TextField
            label="FPS Max"
            value={current.fpsMax}
            onChange={(next) => set("fpsMax", next)}
          />
          <TextField
            label="Refresh Rate"
            value={current.refreshRate}
            onChange={(next) => set("refreshRate", next)}
          />
          <BooleanSelect label="HDR" value={current.hdr} onChange={(next) => set("hdr", next)} />
          <BooleanSelect label="VRR" value={current.vrr} onChange={(next) => set("vrr", next)} />
          <label className="sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block text-xs font-bold">Notes</span>
            <textarea
              rows={2}
              value={current.notes || ""}
              onChange={(event) => set("notes", event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This play mode will not require resolution or FPS.
        </p>
      )}
    </div>
  );
}

export function GamePerformanceEditor({
  value,
  platform,
  requiresSwitch2,
  hardwareProducts,
  onChange,
}: {
  value: unknown;
  platform?: string;
  /** Kept for call-site compatibility; the platform decides everything now. */
  requiresSwitch2?: boolean;
  hardwareProducts: Record_[];
  onChange: (records: DevicePerformance[]) => void;
}) {
  /*
    One record, owned by the platform's device. The admin never picks, adds or
    deletes a device here: `platform` names it, the normalizer resolves its
    hardware identity, and any legacy multi-device data collapses into the one
    canonical record. Editing stays open for everything inside the record.
  */
  const platformKey = resolveGamePlatformKey(platform);
  const normalized = useMemo(
    () =>
      normalizeGameDevicePerformance(
        { platform: platformKey === "switch2" ? "switch2" : "switch1", devicePerformance: value },
        hardwareProducts,
      ),
    [value, platformKey, hardwareProducts],
  );
  const record = normalized[0]!;

  /*
    Self-healing storage: whenever the stored shape differs from the canonical
    single record — two legacy devices, a stale label after a platform change,
    or no record at all — write the normalized form back to the form state.
    Once written, the next render compares equal and the effect goes quiet.
  */
  const storedJson = JSON.stringify(Array.isArray(value) ? value : value ? [value] : []);
  const normalizedJson = JSON.stringify(normalized);
  useEffect(() => {
    if (storedJson !== normalizedJson) onChange(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedJson, normalizedJson]);

  const update = (patch: Partial<DevicePerformance>) => onChange([{ ...record, ...patch }]);

  const isRequired = platformKey === "switch2" || requiresSwitch2 === true;
  const hardwareLinked = Boolean(record.hardwareId);

  return (
    <section className="rounded-xl border border-red-500/25 bg-card p-5 shadow-sm">
      <div className="border-b border-border pb-4">
        <h2 className="flex items-center gap-2 font-bold">
          <Tv className="h-4 w-4 text-red-500" /> Device Performance
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Actual game data only. Device maximum capabilities are never copied here.
        </p>
      </div>

      {/* The device: fixed by the platform, shown, never picked. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Gamepad2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{record.device}</p>
            <p className="text-[11px] text-muted-foreground">
              {record.deviceModel ? `${record.deviceModel} · ` : ""}
              {hardwareLinked
                ? `Linked to hardware product ${record.hardwareId}`
                : "Canonical device identity (no hardware product linked yet)"}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          <Lock className="h-3 w-3" /> Auto-selected from platform
        </span>
      </div>

      <article className="mt-5 space-y-4 rounded-2xl border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-bold">Information Status</span>
            <select
              value={record.informationStatus || "available"}
              onChange={(event) =>
                update({
                  informationStatus: event.target.value as DevicePerformance["informationStatus"],
                })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="available">Available</option>
              <option value="not_published">Performance information not officially published</option>
              <option value="not_tested">Not Tested</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-bold">Verification Status</span>
            <select
              value={record.verificationStatus || ""}
              onChange={(event) =>
                update({
                  verificationStatus: event.target.value as DevicePerformance["verificationStatus"],
                })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select status</option>
              <option value="official">Official</option>
              <option value="verified">Verified</option>
              <option value="technical_analysis">Technical Analysis</option>
              <option value="unverified">Unverified</option>
            </select>
          </label>
        </div>

        {record.informationStatus === "not_published" ||
        record.informationStatus === "not_tested" ? (
          <label className="block">
            <span className="mb-1 block text-xs font-bold">
              Source / reason unavailable <span className="text-red-500">*</span>
            </span>
            <textarea
              rows={2}
              value={record.unavailableReason || ""}
              onChange={(event) => update({ unavailableReason: event.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <PlayModeEditor
              title="Handheld"
              icon={Smartphone}
              mode={record.handheld}
              required={isRequired}
              onChange={(handheld) => update({ handheld })}
            />
            <PlayModeEditor
              title="TV / Docked"
              icon={Tv}
              mode={record.tv}
              required={isRequired}
              onChange={(tv) => update({ tv })}
            />
          </div>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="font-bold">Performance Modes</h4>
            <button
              type="button"
              onClick={() => update({ modes: [...(record.modes || []), { name: "" }] })}
              className="inline-flex items-center gap-1 text-xs font-bold text-primary"
            >
              <Plus className="h-3.5 w-3.5" /> Add Performance Mode
            </button>
          </div>
          <div className="space-y-3">
            {(record.modes || []).map((mode, modeIndex) => (
              <div
                key={modeIndex}
                className="grid gap-3 rounded-xl bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <TextField
                  label="Mode Name"
                  value={mode.name}
                  onChange={(next) =>
                    update({
                      modes: (record.modes || []).map((item, itemIndex) =>
                        itemIndex === modeIndex ? { ...item, name: next } : item,
                      ),
                    })
                  }
                />
                <TextField
                  label="Handheld Resolution"
                  value={mode.handheldResolution}
                  onChange={(next) =>
                    update({
                      modes: (record.modes || []).map((item, itemIndex) =>
                        itemIndex === modeIndex ? { ...item, handheldResolution: next } : item,
                      ),
                    })
                  }
                />
                <TextField
                  label="Handheld FPS"
                  value={mode.handheldFps}
                  onChange={(next) =>
                    update({
                      modes: (record.modes || []).map((item, itemIndex) =>
                        itemIndex === modeIndex ? { ...item, handheldFps: next } : item,
                      ),
                    })
                  }
                />
                <TextField
                  label="TV Resolution"
                  value={mode.tvResolution}
                  onChange={(next) =>
                    update({
                      modes: (record.modes || []).map((item, itemIndex) =>
                        itemIndex === modeIndex ? { ...item, tvResolution: next } : item,
                      ),
                    })
                  }
                />
                <TextField
                  label="TV FPS"
                  value={mode.tvFps}
                  onChange={(next) =>
                    update({
                      modes: (record.modes || []).map((item, itemIndex) =>
                        itemIndex === modeIndex ? { ...item, tvFps: next } : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    update({
                      modes: (record.modes || []).filter(
                        (_, itemIndex) => itemIndex !== modeIndex,
                      ),
                    })
                  }
                  className="self-end justify-self-start rounded-lg border border-red-500/30 p-2 text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="Upscaling"
            value={record.upscaling}
            onChange={(next) => update({ upscaling: next })}
            placeholder="DLSS / FSR / TAAU / Native"
          />
          <BooleanSelect
            label="Ray Tracing"
            value={record.rayTracing}
            onChange={(next) => update({ rayTracing: next })}
          />
          <TextField
            label="Ray Tracing Mode"
            value={record.rayTracingMode}
            onChange={(next) => update({ rayTracingMode: next })}
          />
          <TextField
            label="Loading Time"
            value={record.loadingTime}
            onChange={(next) => update({ loadingTime: next })}
          />
          <TextField
            label="Source Name"
            required={record.informationStatus !== "available"}
            value={record.sourceName}
            onChange={(next) => update({ sourceName: next })}
          />
          <TextField
            label="Source URL"
            type="url"
            value={record.sourceUrl}
            onChange={(next) => update({ sourceUrl: next })}
          />
          <TextField
            label="Game Version"
            value={record.gameVersion}
            onChange={(next) => update({ gameVersion: next })}
          />
          <TextField
            label="Patch"
            value={record.patchVersion}
            onChange={(next) => update({ patchVersion: next })}
          />
          <TextField
            label="Tested Date"
            type="date"
            value={record.testedDate}
            onChange={(next) => update({ testedDate: next })}
          />
          <TextField
            label="Verified Date"
            type="date"
            value={record.verifiedAt}
            onChange={(next) => update({ verifiedAt: next })}
          />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Performance Summary is generated automatically
          from the original fields.
        </p>
      </article>
    </section>
  );
}
