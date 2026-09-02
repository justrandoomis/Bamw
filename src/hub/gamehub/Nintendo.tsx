import { useMemo, useState } from "react";
import {
  ArrowRight,
  Cast,
  CircleSlash,
  Gauge,
  HardDrive,
  Hand,
  KeyRound,
  Monitor,
  Package,
  Smartphone,
  Sparkles,
  Tablet,
  Users,
  Wifi,
  Globe,
} from "lucide-react";
import { useHub } from "./hubContext";
import { Section, Seam } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Chip, Reveal, Segmented } from "@/hub/ui/Bits";
import { BooleanFact, FactValue, NotAvailable } from "@/hub/ui/Fact";
import { SwitchLogo, Switch2Logo } from "@/hub/ui/Icons";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { formatBytes, formatRange } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import type { LanguageChannel, PlayMode, Game } from "@/hub/types";

// Helper to safely access nested fields in components (erased - using existing Row at bottom)

const MODE_META: Record<
  PlayMode,
  { icon: typeof Monitor | typeof Tablet | typeof Smartphone; key: "tv" | "tabletop" | "handheld" }
> = {
  tv: { icon: Monitor, key: "tv" },
  tabletop: { icon: Tablet, key: "tabletop" },
  handheld: { icon: Smartphone, key: "handheld" },
};

/**
 * "Built for Nintendo Switch".
 *
 * This is the storefront's priority platform, so it gets the lead weight and
 * sits directly under the price section. Every value here comes from a `Fact`,
 * which means an unpublished figure renders as "not officially confirmed"
 * rather than as a plausible-looking number.
 */
export function NintendoSection() {
  const { t } = useI18n();
  const { formatConverted } = useCurrency();
  const { game } = useHub();
  const nin = game.nintendo;

  // We show the section if nintendo data exists OR if our new metadata fields are present
  const hasMeta = game.gameIsOffline || game.gameIsOnline || game.gameLanguageLocked;
  if (!nin && !hasMeta) return null;

  const featureLabels: Record<string, string> = {
    motion: t("nintendo.motion"),
    "hd-rumble": t("nintendo.hdRumble"),
    touchscreen: t("nintendo.touchscreen"),
    gyro: t("nintendo.gyro"),
    amiibo: t("nintendo.amiibo"),
    "cloud-saves": t("nintendo.cloudSaves"),
    mouse: t("nintendo.mouse"),
    gamechat: t("nintendo.gamechat"),
  };

  const formatLabels: Record<string, string> = {
    cartridge: t("nintendo.cartridge"),
    "game-key-card": t("nintendo.gameKeyCard"),
    digital: t("nintendo.digital"),
  };

  return (
    <Section
      id="nintendo"
      eyebrow="Nintendo"
      title={t("nintendo.builtFor")}
      subtitle={t("nintendo.subtitle")}
      weight="lead"
    >
      {nin?.switch2Only && (
        <Reveal>
          <Panel tone="accent" className="mb-4 flex items-start gap-3 p-5">
            <Switch2Logo className="mt-0.5 h-5 shrink-0 text-nin-soft" />
            <div>
              <h3 className="text-base font-extrabold">{t("nintendo.switch2Only")}</h3>
              <p className="mt-1 text-sm muted">{t("nintendo.switch2OnlyNote")}</p>
            </div>
          </Panel>
        </Reveal>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Runs on + SKUs */}
        {nin && (
          <Reveal className="lg:col-span-2">
            <Panel className="h-full p-5 sm:p-6">
              <p className="eyebrow mb-4">{t("nintendo.runsOn")}</p>
              <div className="flex flex-wrap gap-2">
                {nin.runsOn.includes("switch") && (
                  <span className="inline-flex items-center gap-2 rounded-xl bg-nin px-3 py-2 text-sm font-bold text-white">
                    <SwitchLogo className="h-4 w-4" />
                    Nintendo Switch
                  </span>
                )}
                {nin.runsOn.includes("switch2") && (
                  <span className="inline-flex items-center gap-2 rounded-xl bg-nin px-3 py-2 text-sm font-bold text-white">
                    <Switch2Logo className="h-4" />
                    Nintendo Switch 2
                  </span>
                )}
              </div>

              {(nin.switch2Edition?.available || nin.switch2Enhanced?.available) && (
                <>
                  <Seam className="my-5" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {nin.switch2Edition?.available && (
                      <div className="inset p-4">
                        <p className="text-xs font-extrabold text-nin-soft">
                          {t("nintendo.switch2Edition")}
                        </p>
                        <p className="mt-1 text-sm font-bold">{nin.switch2Edition.name}</p>
                        {nin.switch2Edition.upgradePack?.available && (
                          <p className="mt-2 text-xs muted">
                            {t("nintendo.switch2Upgrade")}
                            {nin.switch2Edition.upgradePack.price && (
                              <span className="num ms-1.5 font-bold text-good">
                                {formatConverted(nin.switch2Edition.upgradePack.price)}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                    {nin.switch2Enhanced?.available && (
                      <div className="inset flex items-center gap-3 p-4">
                        <Sparkles className="h-5 w-5 shrink-0 text-warn" />
                        <div>
                          <p className="text-xs font-extrabold text-warn">
                            {t("nintendo.switch2Enhanced")}
                          </p>
                          <p className="mt-0.5 text-xs muted">
                            {t("nintendo.improvementCount", {
                              count: nin.switch2Enhanced.enhancements?.length ?? 0,
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {nin.switch2Enhanced?.available && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-white/[0.04] p-3 text-xs leading-relaxed muted">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-warn" />
                      <span>{t("nintendo.switch2Enhanced")}</span>
                    </p>
                  )}
                </>
              )}

              {/* Formats */}
              {nin.formats && nin.formats.length > 0 && (
                <>
                  <Seam className="my-5" />
                  <p className="eyebrow mb-3">{t("nintendo.formats")}</p>
                  <div className="flex flex-wrap gap-2">
                    {nin.formats.map((format, formatIdx) => (
                      <Chip
                        key={`${format}-${formatIdx}`}
                        icon={format === "game-key-card" ? KeyRound : Package}
                        tone={format === "game-key-card" ? "warn" : "default"}
                      >
                        {formatLabels[format] ?? format}
                      </Chip>
                    ))}
                  </div>
                  {nin.gameKeyCard?.value && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn/[0.07] p-3 text-xs leading-relaxed text-warn">
                      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t("nintendo.gameKeyCardNote")}</span>
                    </p>
                  )}
                </>
              )}
            </Panel>
          </Reveal>
        )}

        {/* Play modes + NSO */}
        <Reveal delay={80}>
          <Panel className="flex h-full flex-col p-5 sm:p-6">
            <p className="eyebrow mb-4">{t("nintendo.playModes")}</p>
            {nin && nin.playModes && nin.playModes.length > 0 ? (
              <ul className="space-y-2">
                {(["tv", "tabletop", "handheld"] as PlayMode[]).map((mode) => {
                  const supported = nin.playModes!.includes(mode);
                  const { icon: Icon, key } = MODE_META[mode];
                  return (
                    <li
                      key={mode}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
                        supported ? "bg-white/[0.05] font-semibold" : "muted",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", supported ? "text-nin-soft" : "")} />
                      <span className="flex-1">{t(`nintendo.${key}`)}</span>
                      {supported ? (
                        <span className="text-xs font-bold text-good">{t("common.yes")}</span>
                      ) : (
                        <CircleSlash className="h-3.5 w-3.5" />
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <NotAvailable />
            )}

            {nin?.switchOnline && (
              <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/25 p-4">
                <p className="flex items-center gap-2 text-xs font-extrabold">
                  <Wifi className="h-3.5 w-3.5 text-nin-soft" />
                  {t("nintendo.nso")}
                </p>
                <div className="mt-2 space-y-1.5 text-xs">
                  <Row label={t("multiplayer.online")}>
                    <BooleanFact fact={nin.switchOnline.requiredForOnlinePlay} />
                  </Row>
                  {nin.switchOnline.note && (
                    <p className="pt-1 leading-relaxed muted">{nin.switchOnline.note}</p>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </Reveal>
      </div>

      {/* Hardware features */}
      {nin?.features && nin.features.length > 0 && (
        <Reveal delay={120}>
          <Panel className="mt-4 p-5 sm:p-6">
            <p className="eyebrow mb-4">{t("nintendo.features")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {nin.features.map((feature, featureIdx) => (
                <div
                  key={`${feature.id}-${featureIdx}`}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-xs",
                    feature.supported ? "bg-white/[0.05]" : "bg-black/20",
                  )}
                >
                  <span
                    className={cn(
                      "block font-bold",
                      feature.supported ? "" : "muted line-through decoration-white/25",
                    )}
                  >
                    {featureLabels[feature.id] ?? feature.id}
                  </span>
                  {feature.note && (
                    <span className="mt-0.5 block text-[11px] muted">{feature.note}</span>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </Reveal>
      )}
      {/* Benana Store Specific Meta */}
      {(game.gameIsOffline || game.gameIsOnline || game.gameLanguageLocked) && (
        <Reveal delay={140}>
          <Panel className="mt-4 p-5 sm:p-6">
            <p className="eyebrow mb-4">{t("nintendo.availabilityDetails")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm",
                  game.gameIsOffline ? "bg-white/[0.05] font-semibold" : "muted",
                )}
              >
                <Monitor
                  className={cn("h-4 w-4 shrink-0", game.gameIsOffline ? "text-nin-soft" : "")}
                />
                <span className="flex-1">{t("nintendo.offlineSupport")}</span>
                {game.gameIsOffline ? (
                  <span className="text-xs font-bold text-good">{t("common.yes")}</span>
                ) : (
                  <CircleSlash className="h-3.5 w-3.5" />
                )}
              </div>

              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm",
                  game.gameIsOnline ? "bg-white/[0.05] font-semibold" : "muted",
                )}
              >
                <Wifi
                  className={cn("h-4 w-4 shrink-0", game.gameIsOnline ? "text-nin-soft" : "")}
                />
                <span className="flex-1">{t("nintendo.onlineSupport")}</span>
                {game.gameIsOnline ? (
                  <span className="text-xs font-bold text-good">{t("common.yes")}</span>
                ) : (
                  <CircleSlash className="h-3.5 w-3.5" />
                )}
              </div>

              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm",
                  game.gameLanguageLocked ? "bg-warn/[0.07] text-warn font-semibold" : "muted",
                )}
              >
                <Globe
                  className={cn("h-4 w-4 shrink-0", game.gameLanguageLocked ? "text-warn" : "")}
                />
                <span className="flex-1">{t("nintendo.regionLocked")}</span>
                {game.gameLanguageLocked ? (
                  <span className="text-xs font-bold">{t("common.yes")}</span>
                ) : (
                  <span className="text-xs font-bold text-good">{t("nintendo.none")}</span>
                )}
              </div>
            </div>
          </Panel>
        </Reveal>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Switch 2 enhancements + generation comparison                              */
/* -------------------------------------------------------------------------- */

export function Switch2Section() {
  const { t } = useI18n();
  const { game } = useHub();

  const enhanced = game.nintendo?.switch2Enhanced;
  const switchPerf = game.performance?.find((p) => p.platform === "switch");
  const switch2Perf = game.performance?.find((p) => p.platform === "switch2");

  if (!enhanced?.available) return null;

  return (
    <Section
      id="switch2"
      eyebrow="Nintendo Switch 2"
      title={t("nintendo.switch2Enhanced")}
      subtitle={t("nintendo.enhancedNote")}
      weight="primary"
    >
      {enhanced.enhancements && enhanced.enhancements.length > 0 && (
        <Reveal>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {enhanced.enhancements.map((item) => (
              <Panel key={item.id} interactive className="p-4">
                <p className="flex items-center gap-2 text-sm font-extrabold">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-warn" />
                  {item.label}
                </p>
                {item.detail && (
                  <p className="mt-1 ps-5 text-xs leading-relaxed muted">{item.detail}</p>
                )}
              </Panel>
            ))}
          </div>
        </Reveal>
      )}

      {switchPerf && switch2Perf && (
        <Reveal delay={100}>
          <Panel className="mt-4 overflow-hidden">
            <div className="border-b border-white/[0.06] px-5 py-3.5">
              <p className="text-sm font-extrabold">{t("nintendo.comparison")}</p>
            </div>
            <div className="grid sm:grid-cols-2">
              <GenerationColumn
                title="Nintendo Switch"
                logo={<SwitchLogo className="h-4 w-4" />}
                profile={switchPerf}
              />
              <div className="relative border-t border-white/[0.06] sm:border-s sm:border-t-0">
                <span className="absolute -top-3 start-1/2 hidden -translate-x-1/2 rounded-full bg-nin px-2 py-0.5 text-[10px] font-extrabold text-white sm:block">
                  <ArrowRight className="inline h-3 w-3" />
                </span>
                <GenerationColumn
                  title="Nintendo Switch 2"
                  logo={<Switch2Logo className="h-4" />}
                  profile={switch2Perf}
                  highlight
                />
              </div>
            </div>
          </Panel>
        </Reveal>
      )}
    </Section>
  );
}

function GenerationColumn({
  title,
  logo,
  profile,
  highlight,
}: {
  title: string;
  logo: React.ReactNode;
  profile: NonNullable<ReturnType<typeof useHub>["game"]["performance"]>[number];
  highlight?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("p-5", highlight && "bg-nin/[0.06]")}>
      <p
        className={cn(
          "mb-4 flex items-center gap-2 text-xs font-extrabold",
          highlight ? "text-nin-soft" : "muted",
        )}
      >
        {logo}
        {title}
      </p>
      <div className="space-y-2.5 text-xs">
        {profile.modes?.map((mode, index) => (
          <div key={`${mode.mode}-${index}`} className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider muted">
              {mode.label ?? t(`nintendo.${mode.mode === "pc-preset" ? "tv" : mode.mode}`)}
            </p>
            <Row label={t("performance.resolution")}>
              <FactValue fact={mode.resolution} showBadge={false} />
            </Row>
            <Row label={t("performance.frameRate")}>
              <FactValue fact={mode.frameRate} showBadge={false} />
            </Row>
          </div>
        ))}
        {profile.loadingTime && (
          <Row label={t("performance.loading")}>
            <FactValue fact={profile.loadingTime} showBadge={false} />
          </Row>
        )}
        {profile.hdr && (
          <Row label={t("performance.hdr")}>
            <BooleanFact fact={profile.hdr} />
          </Row>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Performance                                                                */
/* -------------------------------------------------------------------------- */

export function PerformanceSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const profiles = game.performance ?? [];

  const expectedOnSwitch2 = game.nintendo?.runsOn.includes("switch2") ?? false;
  if (profiles.length === 0 && !expectedOnSwitch2) return null;

  return (
    <Section
      id="performance"
      title={t("performance.title")}
      subtitle={t("performance.subtitle")}
      weight="support"
    >
      <Reveal>
        {profiles.length === 0 ? (
          <Panel className="p-6 text-center text-sm muted">
            Performance information for this device has not been published yet.
          </Panel>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
          {profiles.map((profile) => (
            <Panel
              key={profile.hardwareId || profile.deviceSlug || profile.platform}
              className="lg:col-span-3 p-5"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-extrabold">
                  <Gauge className="h-4 w-4 text-nin-soft" />
                  Tested on
                  {profile.deviceSlug ? (
                    <a
                      href={`/hardware/${profile.deviceSlug}`}
                      className="text-nin-soft hover:underline"
                    >
                      {profile.deviceName ||
                        (profile.platform === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch")}
                    </a>
                  ) : (
                    <span>
                      {profile.deviceName ||
                        (profile.platform === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch")}
                    </span>
                  )}
                </p>
                {profile.verifiedAt ? (
                  <span className="rounded-full bg-white/[0.05] px-3 py-1 text-[10px] font-bold muted">
                    Performance verified: {profile.verifiedAt.slice(0, 7)}
                  </span>
                ) : null}
              </div>

              {profile.informationStatus === "not_published" ||
              profile.informationStatus === "not_tested" ? (
                <div className="inset p-4 text-sm muted">
                  Performance information for this device has not been published yet.
                  {profile.unavailableReason ? (
                    <p className="mt-2 text-xs leading-relaxed">{profile.unavailableReason}</p>
                  ) : null}
                </div>
              ) : null}

              {profile.modes?.length ? (
                <div className="grid gap-3.5 text-xs md:grid-cols-2">
                  {profile.modes.map((mode, index) => (
                    <div key={index} className="inset p-3">
                      <p className="mb-3 text-[10px] font-bold uppercase tracking-wider muted">
                        {mode.label ??
                          t(`nintendo.${mode.mode === "pc-preset" ? "tv" : mode.mode}`)}
                      </p>
                      {mode.supported === false ? (
                        <span className="inline-flex rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-bold muted">
                          Not Supported
                        </span>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap gap-2">
                            {mode.resolution?.value ? (
                              <span className="rounded-full bg-nin/15 px-3 py-1.5 font-extrabold text-nin-soft">
                                {mode.resolution.value}
                              </span>
                            ) : null}
                            {mode.frameRate?.value ? (
                              <span className="rounded-full bg-good/10 px-3 py-1.5 font-extrabold text-good">
                                {mode.frameRate.value}
                                {/fps/i.test(String(mode.frameRate.value)) ? "" : " FPS"}
                              </span>
                            ) : null}
                            {mode.hdr?.value === true ? (
                              <span className="rounded-full bg-warn/10 px-3 py-1.5 font-extrabold text-warn">
                                HDR
                              </span>
                            ) : null}
                            {mode.vrr?.value === true ? (
                              <span className="rounded-full bg-white/[0.08] px-3 py-1.5 font-extrabold">
                                VRR
                              </span>
                            ) : null}
                          </div>
                          {mode.renderingResolution ? (
                            <Row label="Rendering Resolution">
                              <FactValue fact={mode.renderingResolution} showBadge={false} />
                            </Row>
                          ) : null}
                          {mode.outputResolution ? (
                            <Row label="Output Resolution">
                              <FactValue fact={mode.outputResolution} showBadge={false} />
                            </Row>
                          ) : null}
                          {mode.refreshRate ? (
                            <Row label="Refresh Rate">
                              <FactValue fact={mode.refreshRate} showBadge={false} />
                            </Row>
                          ) : null}
                        </>
                      )}
                      {mode.notes && <p className="mt-1.5 leading-relaxed muted">{mode.notes}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs muted">{t("performance.noData")}</p>
              )}

              {(profile.loadingTime || profile.notes) && (
                <div className="mt-3 space-y-1.5 text-xs">
                  {profile.loadingTime && (
                    <Row label={t("performance.loading")}>
                      <FactValue fact={profile.loadingTime} showBadge={false} />
                    </Row>
                  )}
                  {profile.notes && <p className="leading-relaxed muted">{profile.notes}</p>}
                </div>
              )}

              {profile.performanceModes?.length ? (
                <div className="mt-4">
                  <p className="eyebrow mb-3">Performance Modes</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {profile.performanceModes.map((mode, index) => (
                      <div key={`${mode.name}-${index}`} className="inset p-4">
                        <p className="font-extrabold">{mode.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                          {mode.handheldResolution ? (
                            <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
                              Handheld {mode.handheldResolution}
                            </span>
                          ) : null}
                          {mode.handheldFps ? (
                            <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
                              {mode.handheldFps} FPS
                            </span>
                          ) : null}
                          {mode.tvResolution ? (
                            <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
                              TV {mode.tvResolution}
                            </span>
                          ) : null}
                          {mode.tvFps ? (
                            <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
                              {mode.tvFps} FPS
                            </span>
                          ) : null}
                          {mode.hdr ? (
                            <span className="rounded-full bg-warn/10 px-2.5 py-1 text-warn">
                              HDR
                            </span>
                          ) : null}
                          {mode.vrr ? (
                            <span className="rounded-full bg-white/[0.08] px-2.5 py-1">VRR</span>
                          ) : null}
                        </div>
                        {mode.notes ? (
                          <p className="mt-2 text-xs leading-relaxed muted">{mode.notes}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {profile.upscaling ||
              profile.rayTracing !== undefined ||
              profile.gameVersion ||
              profile.patchVersion ? (
                <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  {profile.upscaling ? (
                    <div className="inset p-3">
                      <span className="block text-[10px] muted">Upscaling</span>
                      <strong>{profile.upscaling}</strong>
                    </div>
                  ) : null}
                  {profile.rayTracing !== undefined ? (
                    <div className="inset p-3">
                      <span className="block text-[10px] muted">Ray Tracing</span>
                      <strong>
                        {profile.rayTracing
                          ? profile.rayTracingMode || "Supported"
                          : "Not Supported"}
                      </strong>
                    </div>
                  ) : null}
                  {profile.gameVersion ? (
                    <div className="inset p-3">
                      <span className="block text-[10px] muted">Game Version</span>
                      <strong>{profile.gameVersion}</strong>
                    </div>
                  ) : null}
                  {profile.patchVersion ? (
                    <div className="inset p-3">
                      <span className="block text-[10px] muted">Patch</span>
                      <strong>{profile.patchVersion}</strong>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {profile.sourceName || profile.sourceUrl ? (
                <p className="mt-4 text-xs muted">
                  Source:{" "}
                  {profile.sourceUrl ? (
                    <a
                      href={profile.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-bold text-nin-soft hover:underline"
                    >
                      {profile.sourceName || profile.sourceUrl}
                    </a>
                  ) : (
                    <strong>{profile.sourceName}</strong>
                  )}
                </p>
              ) : null}
            </Panel>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}

export function MultiplayerSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const mp = game.multiplayer;

  if (!mp) return null;

  return (
    <Section id="multiplayer" title={t("multiplayer.title")} weight="support">
      <Reveal>
        <Panel className="p-5 sm:p-6">
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {/* A player count when one is recorded, otherwise the support flag. */}
            <Row label={t("multiplayer.localPlayers")} large>
              {formatRange(mp.localPlayers) ??
                (mp.localMultiplayer === undefined ? (
                  <NotAvailable />
                ) : (
                  t(mp.localMultiplayer ? "common.yes" : "common.no")
                ))}
            </Row>
            <Row label={t("multiplayer.onlinePlayers")} large>
              {formatRange(mp.onlinePlayers) ??
                (mp.onlineMultiplayer === undefined ? (
                  <NotAvailable />
                ) : (
                  t(mp.onlineMultiplayer ? "common.yes" : "common.no")
                ))}
            </Row>
            {mp.coop && (
              <Row label={t("multiplayer.coop")} large>
                {t("common.yes")}
              </Row>
            )}
            {mp.competitive && (
              <Row label={t("multiplayer.competitive")} large>
                {t("common.yes")}
              </Row>
            )}
            {mp.splitScreen && (
              <Row label={t("multiplayer.splitScreen")} large>
                {t("common.yes")}
              </Row>
            )}
            {mp.localWireless && (
              <Row label={t("multiplayer.localWireless")} large>
                {t("common.yes")}
              </Row>
            )}
          </div>
        </Panel>
      </Reveal>
    </Section>
  );
}

export function SourcesSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const sources = game.dataSources ?? [];

  if (sources.length === 0) return null;

  return (
    <Section id="sources" title={t("sources.title")} weight="support">
      <Reveal>
        <Panel className="p-5 sm:p-6">
          <ul className="grid gap-3 sm:grid-cols-2">
            {sources.map((source, i) => (
              <li
                key={`${source.url || source.label}-${i}`}
                className="flex items-center gap-3 rounded-xl bg-white/[0.035] px-3 py-2.5"
              >
                <Globe className="h-4 w-4 text-nin-soft" />
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-bold hover:text-white hover:underline"
                  >
                    {source.label}
                  </a>
                ) : (
                  <span className="text-sm font-bold">{source.label}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

export function StorageSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const storage = game.storage;
  const nin = game.nintendo;

  if (!storage) return null;

  const rows = [
    { label: t("storage.downloadSize"), fact: storage.downloadSizeBytes },
    { label: t("storage.requiredSpace"), fact: storage.requiredSpaceBytes },
    { label: t("storage.updateSize"), fact: storage.latestUpdateSizeBytes },
    { label: t("storage.additionalDownload"), fact: storage.additionalDownloadBytes },
  ].filter((row) => row.fact);

  if (rows.length === 0) return null;

  return (
    <Section id="storage" title={t("storage.title")} weight="support">
      <Reveal>
        <Panel className="p-5 sm:p-6">
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <Row key={row.label} label={row.label} large>
                <FactValue
                  fact={row.fact}
                  format={(bytes) => formatBytes(bytes as number, intlLocale)}
                  showBadge={false}
                />
              </Row>
            ))}
            {nin?.gameKeyCard && (
              <Row label={t("nintendo.gameKeyCard")} large>
                <BooleanFact fact={nin.gameKeyCard} />
              </Row>
            )}
            {nin?.physicalRequiresDownload && (
              <Row label={t("storage.physicalNeedsDownload")} large>
                <BooleanFact fact={nin.physicalRequiresDownload} />
              </Row>
            )}
          </div>
          {storage.microSdRecommended && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-white/[0.04] p-3 text-xs muted">
              <HardDrive className="h-3.5 w-3.5 shrink-0" />
              {t("storage.microSd")}
            </p>
          )}
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Languages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Language support, filterable by channel.
 *
 * Interface / audio / subtitles are tracked separately and never merged — "12
 * languages supported" is the single most misleading line on a store page.
 */
export function LanguagesSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const [channel, setChannel] = useState<LanguageChannel | "all">("all");

  const languages = game.languages ?? [];
  if (languages.length === 0) return null;

  const counts = {
    interface: languages.filter((l) => l.channels.includes("interface")).length,
    audio: languages.filter((l) => l.channels.includes("audio")).length,
    subtitles: languages.filter((l) => l.channels.includes("subtitles")).length,
  };

  const visible =
    channel === "all" ? languages : languages.filter((l) => l.channels.includes(channel));

  return (
    <Section
      id="languages"
      title={t("languages.title")}
      subtitle={t("languages.subtitle")}
      weight="support"
      action={
        <Segmented
          size="sm"
          ariaLabel={t("languages.filterBy")}
          value={channel}
          onChange={setChannel}
          options={[
            { id: "all", label: t("common.all"), count: languages.length },
            { id: "interface", label: t("languages.interface"), count: counts.interface },
            { id: "audio", label: t("languages.audio"), count: counts.audio },
            { id: "subtitles", label: t("languages.subtitles"), count: counts.subtitles },
          ]}
        />
      }
    >
      <Reveal>
        <Panel className="p-5 sm:p-6">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((language, langIdx) => (
              <div
                key={`${language.code || language.name}-${langIdx}`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white/[0.035] px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{language.name}</span>
                  {language.nativeName && language.nativeName !== language.name && (
                    <span className="block truncate text-[11px] muted">{language.nativeName}</span>
                  )}
                </span>
                <span className="flex shrink-0 gap-1">
                  {(["interface", "audio", "subtitles"] as LanguageChannel[]).map((ch) => (
                    <span
                      key={ch}
                      title={t(`languages.${ch === "subtitles" ? "subtitles" : ch}`)}
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded text-[9px] font-extrabold uppercase",
                        language.channels.includes(ch)
                          ? "bg-good/15 text-good"
                          : "bg-white/[0.04] text-white/20",
                      )}
                    >
                      {ch[0]}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] muted">
            <span>
              <b className="text-good">I</b> — {t("languages.interface")}
            </span>
            <span>
              <b className="text-good">A</b> — {t("languages.audio")}
            </span>
            <span>
              <b className="text-good">S</b> — {t("languages.subtitles")}
            </span>
          </p>
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Multiplayer                                                                */
/* -------------------------------------------------------------------------- */

function CountBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string | null;
}) {
  return (
    <div className="inset p-4">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p dir="auto" className="mt-1 text-xl font-extrabold">
        {value ?? <NotAvailable />}
      </p>
    </div>
  );
}

function Row({
  label,
  children,
  large,
}: {
  label: string;
  children: React.ReactNode;
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        large && "border-b border-white/[0.05] pb-2",
      )}
    >
      <span className={cn("muted", large ? "text-xs" : "text-[11px]")}>{label}</span>
      <span dir="auto" className={cn("text-end", large ? "text-sm" : "text-xs")}>
        {children}
      </span>
    </div>
  );
}

function platformTitle(platform: string): string {
  const map: Record<string, string> = {
    switch: "Nintendo Switch",
    switch2: "Nintendo Switch 2",
    ps5: "PlayStation 5",
    ps4: "PlayStation 4",
    "xbox-series": "Xbox Series X|S",
    "xbox-one": "Xbox One",
    pc: "PC",
  };
  return map[platform] ?? platform;
}
