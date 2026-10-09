import type { IgFilters } from "@/lib/instagramComments";
import { fromLocalInput, toLocalInput } from "@/lib/contests";

/**
 * The rules a comment must meet — the same fields wherever they are set, so
 * the contest's saved rules and the picker's preview are always one thing.
 */
export default function IgFiltersFields({
  value,
  onChange,
}: {
  value: IgFilters;
  onChange: (next: IgFilters) => void;
}) {
  const set = (patch: Partial<IgFilters>) => onChange({ ...value, ...patch });
  const list = (items: string[]) => items.join("، ");
  const parse = (text: string) =>
    text
      .split(/[,،\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Check
        label="تعليق واحد لكل حساب (المكرر يُحسب مرة)"
        checked={value.oneEntryPerUser}
        onChange={(checked) => set({ oneEntryPerUser: checked })}
      />
      <Check
        label="يجب أن يكون التعليق نصياً (ليس تاغات وإيموجي فقط)"
        checked={value.requireText}
        onChange={(checked) => set({ requireText: checked })}
      />
      <Check
        label="احسب الردود على التعليقات أيضاً"
        checked={value.includeReplies}
        onChange={(checked) => set({ includeReplies: checked })}
      />
      <Field label="أقل عدد تاغات للأصدقاء في التعليق">
        <input
          type="number"
          min={0}
          max={20}
          value={value.minMentions}
          onChange={(event) => set({ minMentions: Number(event.target.value) || 0 })}
          className={INPUT}
        />
      </Field>
      <Field label="أقل طول للنص (بدون التاغات)">
        <input
          type="number"
          min={0}
          max={500}
          value={value.minLength}
          onChange={(event) => set({ minLength: Number(event.target.value) || 0 })}
          className={INPUT}
        />
      </Field>
      <Field label="التعليقات حتى تاريخ (اختياري)">
        <input
          type="datetime-local"
          value={toLocalInput(value.before)}
          onChange={(event) => set({ before: fromLocalInput(event.target.value) || undefined })}
          className={INPUT}
        />
      </Field>
      <Field label="كلمات أو هاشتاغات مطلوبة كلها (افصل بفاصلة)">
        <input
          defaultValue={list(value.requiredWords)}
          onBlur={(event) => set({ requiredWords: parse(event.target.value) })}
          placeholder="#بنانتو"
          className={INPUT}
        />
      </Field>
      <Field label="كلمات تستبعد التعليق (افصل بفاصلة)">
        <input
          defaultValue={list(value.bannedWords)}
          onBlur={(event) => set({ bannedWords: parse(event.target.value) })}
          placeholder="رابط، اعلان"
          className={INPUT}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="حسابات مستبعدة: حساب المتجر، الموظفون، فائزون سابقون (افصل بفاصلة)">
          <input
            defaultValue={list(value.excludeAccounts)}
            onBlur={(event) => set({ excludeAccounts: parse(event.target.value) })}
            placeholder="banan.to, staff_name"
            dir="ltr"
            className={INPUT}
          />
        </Field>
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-bold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-background px-3 py-2 text-[13px] font-bold">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      {label}
    </label>
  );
}
