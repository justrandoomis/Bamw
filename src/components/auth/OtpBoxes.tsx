/** Six-box one-time-code input used by the WhatsApp verification card. */
import { useRef } from "react";

export default function OtpBoxes({
  code,
  setCode,
}: {
  code: string;
  setCode: (next: string) => void;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = code.replace(/\D/g, "").slice(0, 6).padEnd(6, " ").split("");

  const commit = (next: string[]) => {
    setCode(next.join("").replace(/\s/g, ""));
  };

  const focusBox = (index: number) => {
    const target = inputs.current[index];
    if (!target) return;
    target.focus();
    target.select();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const typed = event.target.value.replace(/\D/g, "");
    if (!typed) {
      const next = [...digits];
      next[index] = " ";
      commit(next);
      return;
    }

    // Typing (or pasting) several digits at once fills the following boxes.
    const next = [...digits];
    let cursor = index;
    for (const digit of typed) {
      if (cursor > 5) break;
      next[cursor] = digit;
      cursor += 1;
    }
    commit(next);
    focusBox(Math.min(cursor, 5));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...digits];
      if (next[index] !== " ") {
        next[index] = " ";
        commit(next);
        return;
      }
      if (index > 0) {
        next[index - 1] = " ";
        commit(next);
        focusBox(index - 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    setCode(pasted);
    focusBox(Math.min(pasted.length, 5));
  };

  return (
    <div
      className="relative z-10 my-6 flex justify-center gap-2 sm:gap-3"
      dir="ltr"
      onPaste={handlePaste}
    >
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          type="text"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          value={digits[index]!.trim()}
          onChange={(event) => handleChange(event, index)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onFocus={(event) => event.currentTarget.select()}
          className="h-12 w-10 border-[2px] border-[var(--ink-soft)] bg-[var(--page-3)] text-center text-xl font-[900] text-[var(--ink-soft)] transition-colors focus:bg-[var(--gold)]/30 focus:outline-none sm:h-14 sm:w-12 sm:text-2xl"
          style={{ borderRadius: "22px" }}
        />
      ))}
    </div>
  );
}
