const shortName = (name: string) => name.split("__").at(-1) || name;
const label = (value: unknown) => typeof value === "string" ? value.slice(0, 72).replace(/[\uD800-\uDBFF]$/, "").replace(/[\x00-\x1f\x7f-\x9f]|\p{Cf}/gu, " ").trim() : "";
export const compactSubagent = (name: string) => /^(?:subagents?(?:_|$)|contact_supervisor$)/i.test(shortName(name));
export const subagentDecision = (name: string, args: any) => shortName(name) === "contact_supervisor" && ["need_decision", "interview_request"].includes(args?.reason);

/** Summarize only recorded contracts. Tool completion does not establish child completion. */
export function subagentTitle(name: string, args: any, result: any, status: string): string {
  const short = shortName(name), details = result?.details;
  const failed = status === "failed" || result?.isError;
  const waiting = !result || status === "running" || status === "pending";
  const phase = status === "pending" ? "Preparing" : "Running";
  if (short === "contact_supervisor") {
    const decision = subagentDecision(name, args);
    const title = decision ? "Supervisor decision" : "Supervisor update";
    const state = failed ? "✗ Failed" : waiting ? decision ? "Pending" : phase
      : details?.reason === "progress_update" && details?.delivered === true ? "Queued"
      : ["need_decision", "interview_request"].includes(details?.reason) && typeof details?.requestId === "string" ? "Reply recorded" : "Result recorded";
    return `${title} · ${state}`;
  }
  const supervisor = short === "subagent_supervisor";
  const action = label(args?.action) || (supervisor ? "request" : ["subagent", "subagents"].includes(short) ? "launch" : label(short.replace(/^subagents?_/, "")));
  // Targets such as run/request UUIDs and arbitrary messages belong in Details.
  const agent = label(details?.agent ?? args?.agent);
  const topic = action === "guide" ? label(args?.options?.topic) : "";
  const title = `${supervisor ? "Supervisor" : "Subagent"} · ${action}${topic ? ` · ${topic}` : agent ? ` · ${agent}` : ""}`;
  if (failed) return `${title} · ✗ Failed · ${action === "steer" ? details?.steering ? "Steering failed" : "Steering rejected" : action === "launch" ? details?.activeAsyncCapacity ? "Capacity reached" : "Launch failed" : "Request failed"}`;
  if (waiting) return `${title} · ${phase}`;
  if (action === "guide") return title;
  if (supervisor && action === "reply" && typeof details?.replyTo === "string") return `${title} · Reply recorded`;
  if (action === "steer") {
    const steering = details?.steering;
    const state = steering?.state;
    // Keep partial, scheduled and recovered receipts distinct from delivery.
    const states: Record<string, string> = { failed: "Steering failed", partial: "Partial steering result", scheduled: "Scheduled", recovered: "Recovered", delivered: "Delivered" };
    const receipt = typeof state === "string" && Object.hasOwn(states, state) ? states[state] : undefined;
    return `${title} · ${receipt ?? (steering?.deliveryStatus === "queued" ? "Queued" : "Result recorded")}`;
  }
  if (["status", "pending", "list"].includes(action)) return `${title} · Status recorded`;
  if (action === "launch" || action === "resume") {
    const results = details?.results;
    const launchMode = ["single", "parallel", "chain", "workflow"].includes(details?.mode);
    if (launchMode && Array.isArray(results)) {
      if (!results.length && typeof details?.asyncId === "string" && details.asyncId) return `${title} · Started asynchronously`;
      if (results.some((item: any) => item?.detached === true)) return `${title} · Detached`;
      if (results.some((item: any) => item?.interrupted === true)) return `${title} · Interrupted`;
      if (results.some((item: any) => item?.timedOut === true)) return `${title} · Timed out`;
      if (results.some((item: any) => item?.stopped === true)) return `${title} · Stopped`;
      if (results.length && results.every((item: any) => item && item.exitCode === 0 && !item.error && !item.outputPartial && !item.turnBudgetExceeded && !item.toolBudgetBlocked && !item.structuredOutputFailed && (!item.execution || item.execution.status === "completed"))) return `${title} · Completed`;
    }
  }
  return `${title} · Result recorded`;
}
