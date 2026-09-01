import { useEffect, useRef } from "react";
import { Plus, Trash2, Tv, Smartphone, ShieldCheck } from "lucide-react";

import {
  normalizeDevicePerformance,
  slugifyDevice,
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
  requiresSwitch2?: boolean;
  hardwareProducts: Record_[];
  onChange: (records: DevicePerformance[]) => void;
}) {
  const records = (Array.isArray(value) ? value : value ? [value] : [])
    .map(normalizeDevicePerformance)
    .filter(Boolean) as DevicePerformance[];
  const switch2Required =
    requiresSwitch2 ?? ["switch2", "both"].includes(String(platform || "").toLowerCase());

  const update = (index: number, patch: Partial<DevicePerformance>) =>
    onChange(
      records.map((record, recordIndex) =>
        recordIndex === index ? { ...record, ...patch } : record,
      ),
    );
  const add = () => {
    const preferred =
      hardwareProducts.find(
        (hardware) => slugifyDevice(hardware.slug || hardware.title) === "nintendo-switch-2",
      ) || hardwareProducts[0];
    onChange([
      ...records,
      {
        device: String(preferred?.title || preferred?.name || ""),
        deviceSlug: slugifyDevice(preferred?.slug || preferred?.title || ""),
        hardwareId: preferred?.id ? String(preferred.id) : undefined,
        deviceModel: String(preferred?.model || preferred?.modelNumber || ""),
        informationStatus: "available",
        handheld: { supported: true },
        tv: { supported: true },
        modes: [],
      },
    ]);
  };

  /*
    Every game in the store runs on Nintendo Switch 2, so a game with no
    device rows seeds one for it instead of making the admin click Add
    Device and pick the same console on every product. Guarded by a ref so
    a deliberately emptied list is not refilled.
  */
  const seededRef = useRef(false);
  const hasRecords = records.length > 0;
  const hasHardware = hardwareProducts.length > 0;
  useEffect(() => {
    if (seededRef.current || hasRecords || !hasHardware) return;
    seededRef.current = true;
    add();
    // `add` is recreated per render; the primitive guards make this effect
    // fire exactly once, when the hardware list first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRecords, hasHardware]);

  return (
    <section className="rounded-xl border border-red-500/25 bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold">
            <Tv className="h-4 w-4 text-red-500" /> Device Performance
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Actual game data only. Device maximum capabilities are never copied here.
          </p>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add Device
        </button>
      </div>

      {switch2Required && !records.some((record) => record.deviceSlug === "nintendo-switch-2") ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          Nintendo Switch 2 performance information is required before saving.
        </div>
      ) : null}
      {!hardwareProducts.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Add a Hardware Product first; device choices are loaded from the hardware database.
        </p>
      ) : null}

      <div className="mt-5 space-y-5">
        {records.map((record, index) => {
          const isRequired = switch2Required && record.deviceSlug === "nintendo-switch-2";
          return (
            <article
              key={`${record.hardwareId || record.deviceSlug}-${index}`}
              className="space-y-4 rounded-2xl border border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[220px] flex-1">
                  <span className="mb-1 block text-xs font-bold">
                    Device {isRequired ? <span className="text-red-500">*</span> : null}
                  </span>
                  <select
                    value={record.hardwareId || ""}
                    onChange={(event) => {
                      const hardware = hardwareProducts.find(
                        (item) => String(item.id) === event.target.value,
                      );
                      if (!hardware) return;
                      update(index, {
                        hardwareId: String(hardware.id),
                        device: String(hardware.title || hardware.name || ""),
                        deviceSlug: slugifyDevice(hardware.slug || hardware.title || ""),
                        deviceModel: String(hardware.model || hardware.modelNumber || ""),
                      });
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select Hardware Product</option>
                    {hardwareProducts.map((hardware) => (
                      <option key={String(hardware.id)} value={String(hardware.id)}>
                        {String(hardware.title || hardware.name)}
                        {hardware.model ? ` — ${hardware.model}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onChange(records.filter((_, recordIndex) => recordIndex !== index))
                  }
                  className="rounded-lg border border-red-500/30 p-2 text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mb-1 block text-xs font-bold">Information Status</span>
                  <select
                    value={record.informationStatus || "available"}
                    onChange={(event) =>
                      update(index, {
                        informationStatus: event.target
                          .value as DevicePerformance["informationStatus"],
                      })
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="available">Available</option>
                    <option value="not_published">
                      Performance information not officially published
                    </option>
                    <option value="not_tested">Not Tested</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-xs font-bold">Verification Status</span>
                  <select
                    value={record.verificationStatus || ""}
                    onChange={(event) =>
                      update(index, {
                        verificationStatus: event.target
                          .value as DevicePerformance["verificationStatus"],
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
                    onChange={(event) => update(index, { unavailableReason: event.target.value })}
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
                    onChange={(handheld) => update(index, { handheld })}
                  />
                  <PlayModeEditor
                    title="TV / Docked"
                    icon={Tv}
                    mode={record.tv}
                    required={isRequired}
                    onChange={(tv) => update(index, { tv })}
                  />
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="font-bold">Performance Modes</h4>
                  <button
                    type="button"
                    onClick={() =>
                      update(index, { modes: [...(record.modes || []), { name: "" }] })
                    }
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
                          update(index, {
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
                          update(index, {
                            modes: (record.modes || []).map((item, itemIndex) =>
                              itemIndex === modeIndex
                                ? { ...item, handheldResolution: next }
                                : item,
                            ),
                          })
                        }
                      />
                      <TextField
                        label="Handheld FPS"
                        value={mode.handheldFps}
                        onChange={(next) =>
                          update(index, {
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
                          update(index, {
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
                          update(index, {
                            modes: (record.modes || []).map((item, itemIndex) =>
                              itemIndex === modeIndex ? { ...item, tvFps: next } : item,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          update(index, {
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
                  onChange={(next) => update(index, { upscaling: next })}
                  placeholder="DLSS / FSR / TAAU / Native"
                />
                <BooleanSelect
                  label="Ray Tracing"
                  value={record.rayTracing}
                  onChange={(next) => update(index, { rayTracing: next })}
                />
                <TextField
                  label="Ray Tracing Mode"
                  value={record.rayTracingMode}
                  onChange={(next) => update(index, { rayTracingMode: next })}
                />
                <TextField
                  label="Loading Time"
                  value={record.loadingTime}
                  onChange={(next) => update(index, { loadingTime: next })}
                />
                <TextField
                  label="Source Name"
                  required={record.informationStatus !== "available"}
                  value={record.sourceName}
                  onChange={(next) => update(index, { sourceName: next })}
                />
                <TextField
                  label="Source URL"
                  type="url"
                  value={record.sourceUrl}
                  onChange={(next) => update(index, { sourceUrl: next })}
                />
                <TextField
                  label="Game Version"
                  value={record.gameVersion}
                  onChange={(next) => update(index, { gameVersion: next })}
                />
                <TextField
                  label="Patch"
                  value={record.patchVersion}
                  onChange={(next) => update(index, { patchVersion: next })}
                />
                <TextField
                  label="Tested Date"
                  type="date"
                  value={record.testedDate}
                  onChange={(next) => update(index, { testedDate: next })}
                />
                <TextField
                  label="Verified Date"
                  type="date"
                  value={record.verifiedAt}
                  onChange={(next) => update(index, { verifiedAt: next })}
                />
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Performance Summary is generated
                automatically from the original fields.
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
