import { useEffect, useRef, useState } from "react";

import { tr, useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { normalizeUsername, usernameProblem, usernameProblemText } from "@/lib/loginCode";

export type UsernameState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; username: string }
  | { status: "unavailable"; message: string };

/** Whether a username can be had, checked as the member types — locally first, then by the server. */
export function useUsernameCheck(raw: string): UsernameState {
  const [state, setState] = useState<UsernameState>({ status: "idle" });
  const lang = useI18n((s) => s.lang);
  const latest = useRef(0);

  useEffect(() => {
    const name = normalizeUsername(raw);
    if (!name) {
      setState({ status: "idle" });
      return;
    }
    const problem = usernameProblem(name);
    if (problem) {
      setState({
        status: "unavailable",
        message: usernameProblemText(problem, lang === "ar" || lang === "ku" ? "ar" : "en"),
      });
      return;
    }
    setState({ status: "checking" });
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      api
        .usernameCheck(name)
        .then((res) => {
          if (ticket !== latest.current) return;
          setState(
            res.available
              ? { status: "available", username: res.username }
              : {
                  status: "unavailable",
                  message: res.error || tr("هذا الاسم مستخدم، اختر اسماً آخر"),
                },
          );
        })
        .catch(() => {
          if (ticket === latest.current) setState({ status: "idle" });
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [raw, lang]);

  return state;
}
