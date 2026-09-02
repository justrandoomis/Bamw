import { describe, expect, it } from "vitest";

import { parseGameImport } from "./gameImportParser";
import { BOOLEAN_ONLY_NOTE, generateGameImportTemplate } from "./gameImportGenerator";
import { GAME_IMPORT_SCHEMA, type FieldDef } from "./gameImportSchema";

const template = generateGameImportTemplate();
const lines = template.split("\n");
const NOTE = `# ${BOOLEAN_ONLY_NOTE}`;

/** The field a template line such as `device_performance.1.tv.hdr=` belongs to. */
function fieldForPath(path: string): FieldDef | undefined {
  const segments = path.split(".");
  const head = segments.shift();
  let field = GAME_IMPORT_SCHEMA.find((entry) => entry.key === head && entry.itemFields)
    ? GAME_IMPORT_SCHEMA.find((entry) => entry.key === head && entry.itemFields)
    : GAME_IMPORT_SCHEMA.find((entry) => entry.key === head);
  for (const segment of segments) {
    if (!field) return undefined;
    if (/^\d+$/.test(segment)) continue;
    field = field.itemFields?.[segment];
  }
  return field;
}

/** Every `key=` / `key<<EOF` line, with the line number it sits on. */
const valueLines = lines
  .map((text, index) => ({ text, index }))
  .filter(({ text }) => /^[a-z0-9_.]+(=|<<EOF)/i.test(text))
  .map(({ text, index }) => ({ index, path: text.split(/=|<</)[0]!.trim() }));

describe("the BOOLEAN ONLY note sits only above boolean fields", () => {
  it("is followed by a boolean field every single time", () => {
    const notes = lines.map((text, index) => ({ text, index })).filter(({ text }) => text === NOTE);
    expect(notes.length).toBeGreaterThan(0);

    for (const note of notes) {
      const next = valueLines.find((line) => line.index > note.index);
      expect(next, `note on line ${note.index + 1} has no field under it`).toBeDefined();
      const field = fieldForPath(next!.path);
      expect(field, `unknown field ${next!.path}`).toBeDefined();
      expect(field!.type, `${next!.path} is annotated BOOLEAN ONLY but is ${field!.type}`).toBe(
        "boolean",
      );
    }
  });

  it("never annotates the text fields of a device performance record", () => {
    for (const key of [
      "device",
      "device_slug",
      "device_model",
      "hardware_id",
      "information_status",
    ]) {
      for (const index of [1, 2, 3]) {
        const line = lines.indexOf(`device_performance.${index}.${key}=`);
        expect(line, `device_performance.${index}.${key} missing`).toBeGreaterThan(-1);
        expect(lines[line - 1]).not.toBe(NOTE);
      }
    }
  });

  it("never annotates a resolution, an fps, a mode or a notes field", () => {
    for (const key of [
      "resolution",
      "rendering_resolution",
      "output_resolution",
      "fps",
      "fps_min",
      "fps_max",
      "refresh_rate",
      "mode",
    ]) {
      for (const section of ["handheld", "tv"]) {
        const line = lines.indexOf(`device_performance.1.${section}.${key}=`);
        expect(line, `${section}.${key} missing`).toBeGreaterThan(-1);
        expect(lines[line - 1], `${section}.${key} was annotated as boolean`).not.toBe(NOTE);
      }
    }
    for (const key of ["ray_tracing_mode", "upscaling", "loading_time"]) {
      const line = lines.indexOf(`device_performance.1.${key}=`);
      expect(line).toBeGreaterThan(-1);
      expect(lines[line - 1], `${key} was annotated as boolean`).not.toBe(NOTE);
    }
  });

  it("annotates supported, hdr and vrr on every device index and both screens", () => {
    /*
      Covered by a note means: walking upwards from the field, every value line
      passed is itself boolean and the run is headed by the note. `vrr` sits
      directly under `hdr`, and one note covers both.
    */
    const annotated = (path: string) => {
      const line = lines.indexOf(`${path}=`);
      expect(line, `${path} missing from the template`).toBeGreaterThan(-1);
      for (let cursor = line - 1; cursor >= 0; cursor--) {
        const text = lines[cursor]!;
        if (text === NOTE) return true;
        if (!/^[a-z0-9_.]+(=|<<EOF)/i.test(text)) continue;
        const field = fieldForPath(text.split(/=|<</)[0]!.trim());
        if (field?.type !== "boolean") return false;
      }
      return false;
    };

    for (const index of [1, 2, 3]) {
      for (const section of ["handheld", "tv"]) {
        expect(annotated(`device_performance.${index}.${section}.supported`)).toBe(true);
        expect(annotated(`device_performance.${index}.${section}.resolution_dynamic`)).toBe(true);
        expect(annotated(`device_performance.${index}.${section}.hdr`)).toBe(true);
        expect(annotated(`device_performance.${index}.${section}.vrr`)).toBe(true);
      }
      for (const mode of [1, 2, 3]) {
        expect(annotated(`device_performance.${index}.mode.${mode}.hdr`)).toBe(true);
        expect(annotated(`device_performance.${index}.mode.${mode}.vrr`)).toBe(true);
      }
      expect(annotated(`device_performance.${index}.ray_tracing`)).toBe(true);
    }
  });

  it("heads the whole multiplayer block with one note", () => {
    // The note sits above the first flag of the group, not above a neighbour.
    const noteLine = lines.findIndex(
      (text, index) => text === NOTE && lines[index + 2] === "multiplayer_local=",
    );
    expect(noteLine).toBeGreaterThan(-1);
    for (const key of [
      "multiplayer_local",
      "multiplayer_online",
      "multiplayer_cooperative",
      "multiplayer_competitive",
      "multiplayer_split_screen",
      "multiplayer_local_wireless",
    ]) {
      const line = lines.indexOf(`${key}=`);
      expect(line, `${key} missing`).toBeGreaterThan(-1);
      expect(line).toBeGreaterThan(noteLine);
    }
  });

  it("states the rule once at the top, and spells out resolution_dynamic", () => {
    expect(template).toContain("# BOOLEAN RULE:");
    expect(template).toContain("#   blank if unknown");
    expect(template).toContain("# Never write: Not Published / Unknown / N/A / Yes / No");
    expect(template).toContain("# resolution_dynamic is BOOLEAN ONLY:");
    expect(template).toContain("#   true  = resolution is dynamic");
    expect(template).toContain("#   false = resolution is fixed");
    // Player counts are pointed at their own fields, not at a flag.
    expect(template).toContain("# Player counts live in players_count / players / player_count");
    // The old, wrong guidance is gone.
    expect(template).not.toContain("local player count, e.g. 1-4");
    expect(template).not.toContain("a dynamic resolution range");
  });
});

describe("validation sample from the request", () => {
  const SAMPLE = `
schema_version=1
name=Boolean Annotation Sample
platform=switch2

device_performance.1.device=Nintendo Switch 2
device_performance.1.handheld.supported=true
device_performance.1.handheld.resolution_dynamic=true
device_performance.1.handheld.output_resolution=1920x1080
device_performance.1.handheld.fps=60
device_performance.1.handheld.hdr=
device_performance.1.handheld.vrr=false

device_performance.1.tv.supported=true
device_performance.1.tv.resolution_dynamic=true
device_performance.1.tv.output_resolution=3840x2160
device_performance.1.tv.fps=60
device_performance.1.tv.hdr=false
device_performance.1.tv.vrr=

device_performance.1.ray_tracing=

multiplayer_local=true
multiplayer_online=true
multiplayer_cooperative=true
multiplayer_competitive=false
multiplayer_split_screen=true
multiplayer_local_wireless=false
`;

  const result = parseGameImport(SAMPLE);

  it("imports with no boolean validation error at all", () => {
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.errors.some((issue) => /boolean/i.test(issue.message))).toBe(false);
    expect(result.unknownFields).toEqual([]);
  });

  it("reads true, false and blank on every boolean in the sample", () => {
    const device = (result.data["devicePerformance"] as Record<string, any>[])[0]!;
    expect(device["handheld"].supported).toBe(true);
    expect(device["handheld"].vrr).toBe(false);
    expect(device["handheld"].hdr).toBeUndefined();
    expect(device["tv"].supported).toBe(true);
    expect(device["tv"].hdr).toBe(false);
    expect(device["tv"].vrr).toBeUndefined();
    // Blank ray tracing simply is not recorded.
    expect(device["rayTracing"]).toBeUndefined();

    expect(result.data["mpCoop"]).toBe(true);
    expect(result.data["mpCompetitive"]).toBe(false);
    expect(result.data["mpSplitScreen"]).toBe(true);
    expect(result.data["mpLocalWireless"]).toBe(false);
  });

  it("never coerces a genuine string field into a boolean", () => {
    const device = (result.data["devicePerformance"] as Record<string, any>[])[0]!;
    expect(device["device"]).toBe("Nintendo Switch 2");
    expect(device["handheld"].outputResolution).toBe("1920x1080");
    expect(device["handheld"].fps).toBe("60");
    expect(typeof device["handheld"].fps).toBe("string");
  });

  it("reads resolution_dynamic and the multiplayer flags as booleans", () => {
    const device = (result.data["devicePerformance"] as Record<string, any>[])[0]!;
    expect(device["handheld"].resolutionDynamic).toBe(true);
    expect(device["tv"].resolutionDynamic).toBe(true);
    expect(result.data["mpLocalPlayers"]).toBe(true);
    expect(result.data["mpOnlinePlayers"]).toBe(true);
  });
});

describe("resolution_dynamic and the multiplayer flags are boolean", () => {
  const SAMPLE = `
schema_version=1
name=Resolution Flag Sample
platform=switch2

device_performance.1.device=Nintendo Switch 2

device_performance.1.handheld.resolution=468p-648p
device_performance.1.handheld.resolution_dynamic=true
device_performance.1.handheld.fps=60

device_performance.1.tv.resolution=720p-900p
device_performance.1.tv.resolution_dynamic=true
device_performance.1.tv.fps=60

multiplayer_local=true
multiplayer_online=true
multiplayer_cooperative=true
multiplayer_competitive=false
multiplayer_split_screen=true
multiplayer_local_wireless=false
`;

  it("imports the sample with no validation error", () => {
    const parsed = parseGameImport(SAMPLE);
    expect(parsed.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(parsed.unknownFields).toEqual([]);
  });

  it("keeps the measured resolutions where they belong", () => {
    const device = (parseGameImport(SAMPLE).data["devicePerformance"] as Record<string, any>[])[0]!;
    expect(device["handheld"].resolution).toBe("468p-648p");
    expect(device["handheld"].resolutionDynamic).toBe(true);
    expect(device["tv"].resolution).toBe("720p-900p");
    expect(device["tv"].resolutionDynamic).toBe(true);
  });

  it("reads all six multiplayer flags as booleans", () => {
    const data = parseGameImport(SAMPLE).data;
    expect(data["mpLocalPlayers"]).toBe(true);
    expect(data["mpOnlinePlayers"]).toBe(true);
    expect(data["mpCoop"]).toBe(true);
    expect(data["mpCompetitive"]).toBe(false);
    expect(data["mpSplitScreen"]).toBe(true);
    expect(data["mpLocalWireless"]).toBe(false);
    for (const key of [
      "mpLocalPlayers",
      "mpOnlinePlayers",
      "mpCoop",
      "mpCompetitive",
      "mpSplitScreen",
      "mpLocalWireless",
    ]) {
      expect(typeof data[key]).toBe("boolean");
    }
  });

  it("refuses a resolution written into resolution_dynamic", () => {
    const errors = parseGameImport(
      `schema_version=1\nname=Bad\nplatform=switch1\ndevice_performance.1.handheld.resolution_dynamic=468p-648p\n`,
    ).errors.filter((issue) => issue.severity === "error");
    /*
      This fixture is deliberately one bad line, so it also trips the rule that
      a game must carry a performance record for its own platform. The subject
      here is the type of the field, so assert on that error rather than on the
      total, which would make an unrelated rule able to break this test.
    */
    const typeErrors = errors.filter((issue) => issue.message.includes("boolean"));
    expect(typeErrors).toHaveLength(1);
    // The message quotes the value it refused, which is what tells an importer
    // what to correct; the issue itself is keyed to the group.
    expect(typeErrors[0]!.message).toContain("468p-648p");
  });

  it("refuses a player count written into a multiplayer flag", () => {
    for (const bad of ["1-4", "2-8"]) {
      const errors = parseGameImport(
        `schema_version=1\nname=Bad\nplatform=switch1\nmultiplayer_local=${bad}\n`,
      ).errors.filter((issue) => issue.severity === "error");
      // Same reason as above: the subject is this field, not the whole file.
      const fieldErrors = errors.filter((issue) => issue.key === "multiplayer_local");
      expect(fieldErrors).toHaveLength(1);
    }
  });

  it("accepts blank on both, recording nothing", () => {
    const data = parseGameImport(
      `schema_version=1\nname=Blank\nplatform=switch1\nmultiplayer_local=\nmultiplayer_online=\ndevice_performance.1.device=Nintendo Switch\ndevice_performance.1.handheld.resolution_dynamic=\n`,
    ).data;
    expect(data["mpLocalPlayers"]).toBeUndefined();
    expect(data["mpOnlinePlayers"]).toBeUndefined();
    const device = (data["devicePerformance"] as Record<string, any>[])[0]!;
    expect(device["handheld"]?.resolutionDynamic).toBeUndefined();
  });
});
